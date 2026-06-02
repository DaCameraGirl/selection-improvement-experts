#!/usr/bin/env python3
"""Independent verifier for the offline Git recovery task."""
import json, os, re, shutil, stat, subprocess, sys, tempfile
from pathlib import Path

GIT = "git.exe" if os.name == "nt" else "git"

def fail(code, message):
    print(f"FAIL [{code}]: {message}")
    sys.exit(1)

def git(args, cwd=None):
    return subprocess.run([GIT] + args, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")

def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:
        fail("SCHEMA_INVALID", f"{path}: {exc}")

def schema_check(value, schema, label):
    expected_type = schema.get("type")
    if isinstance(expected_type, list):
        allowed = expected_type
    elif expected_type:
        allowed = [expected_type]
    else:
        allowed = []
    type_map = {"object": dict, "array": list, "string": str, "integer": int,
                "boolean": bool, "null": type(None)}
    if allowed and not any(isinstance(value, type_map[t]) and not (t == "integer" and isinstance(value, bool)) for t in allowed):
        fail("SCHEMA_INVALID", f"{label}: expected {allowed}, got {type(value).__name__}")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                fail("SCHEMA_INVALID", f"{label}: missing key {key}")
        properties = schema.get("properties", {})
        extra_schema = schema.get("additionalProperties", True)
        for key, item in value.items():
            if key in properties:
                schema_check(item, properties[key], f"{label}.{key}")
            elif extra_schema is False:
                fail("SCHEMA_INVALID", f"{label}: unexpected key {key}")
            elif isinstance(extra_schema, dict):
                schema_check(item, extra_schema, f"{label}.{key}")
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            schema_check(item, schema["items"], f"{label}[{index}]")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            fail("SCHEMA_INVALID", f"{label}: string is too short")
        if schema.get("pattern") and not re.match(schema["pattern"], value):
            fail("SCHEMA_INVALID", f"{label}: value {value!r} does not match {schema['pattern']}")
        if schema.get("enum") and value not in schema["enum"]:
            fail("SCHEMA_INVALID", f"{label}: unexpected value {value!r}")
    if isinstance(value, int) and not isinstance(value, bool) and value < schema.get("minimum", value):
        fail("SCHEMA_INVALID", f"{label}: below minimum")

required = [
    "outputs/recovery_tool.py", "outputs/repaired_repo.bundle", "outputs/repair_log.json",
    "outputs/commit_graph_report.json", "outputs/recovery_case_report.json", "outputs/run_manifest.json"
]
for name in required:
    item = Path(name)
    if not item.exists() or item.stat().st_size == 0:
        fail("MISSING_FILE", name)

reports = {}
for name in ["repair_log", "commit_graph_report", "recovery_case_report", "run_manifest"]:
    reports[name] = read_json(f"outputs/{name}.json")
    schema = read_json(f"output_schemas/{name}.schema.json")
    schema_check(reports[name], schema, name)

compile_check = subprocess.run([sys.executable, "-m", "py_compile", "outputs/recovery_tool.py"],
                               capture_output=True, text=True)
if compile_check.returncode != 0:
    fail("TEST_FAIL", f"outputs/recovery_tool.py does not compile: {compile_check.stderr.strip()}")

def bundle_signature(bundle_path):
    with tempfile.TemporaryDirectory() as td:
        mirror = str(Path(td) / "repo.git")
        clone = git(["clone", "--mirror", str(Path(bundle_path).resolve()), mirror])
        if clone.returncode != 0:
            fail("TEST_FAIL", f"{bundle_path}: clone failed: {clone.stderr.strip()}")
        fsck = git(["fsck", "--connectivity-only"], cwd=mirror)
        if fsck.returncode != 0:
            fail("TEST_FAIL", f"{bundle_path}: fsck failed: {(fsck.stdout + fsck.stderr).strip()}")
        refs = {}
        for line in git(["show-ref", "--heads"], cwd=mirror).stdout.splitlines():
            sha, ref = line.split()
            refs[ref] = sha
        histories = {ref: git(["rev-list", ref], cwd=mirror).stdout.splitlines() for ref in sorted(refs)}
        return {"refs": refs, "histories": histories, "fsck": fsck.returncode}, mirror

primary_sig, _ = bundle_signature("outputs/repaired_repo.bundle")
expected_refs = read_json("expected_refs.json")
if primary_sig["refs"] != expected_refs:
    fail("TEST_FAIL", f"bundle refs differ from expected_refs.json: {primary_sig['refs']}")

repair = reports["repair_log"]
if repair["refs_expected"] != expected_refs or repair["refs_restored"] != expected_refs:
    fail("CONTRACT_DRIFT", "repair_log refs do not equal expected_refs.json")
if repair["branches_restored"] != list(expected_refs.keys()) or repair["all_refs_restored"] is not True:
    fail("CONTRACT_DRIFT", "repair_log branch order or all_refs_restored value is wrong")

expected_reflog, seen = [], set()
for line in Path("reflog_export.txt").read_text(encoding="utf-8").splitlines():
    match = re.match(r"^([a-f0-9]{7,40})\s", line)
    if match and match.group(1)[:7] not in seen:
        seen.add(match.group(1)[:7])
        expected_reflog.append(match.group(1)[:7])
if repair["orphaned_shas"] != expected_reflog:
    fail("CONTRACT_DRIFT", "repair_log.orphaned_shas must use 7-character first-seen reflog order")

graph = reports["commit_graph_report"]["branches"]
spec = read_json("commit_graph_spec.json")["branches"]
if set(graph) != set(spec):
    fail("CONTRACT_DRIFT", "commit graph branch set differs from spec")
for ref, contract in spec.items():
    found = graph[ref]
    expected_ancestors = [sha[:7] for sha in contract["expected_ancestors"]]
    if found["tip"] != contract["expected_tip"] or found["expected_ancestors"] != expected_ancestors:
        fail("CONTRACT_DRIFT", f"{ref}: graph report contract fields differ")
    if found["all_reachable"] is not True or found["found_ancestors"][:len(expected_ancestors)] != expected_ancestors:
        fail("TEST_FAIL", f"{ref}: ancestor chain differs")

expected_checksums = read_json("expected_file_checksums.json")
with tempfile.TemporaryDirectory() as td:
    clone = git(["clone", "--mirror", str(Path("outputs/repaired_repo.bundle").resolve()), td])
    if clone.returncode != 0:
        fail("TEST_FAIL", "primary mirror clone failed")
    for sha, files in expected_checksums.items():
        if sha not in repair["checksums"]:
            fail("CONTRACT_DRIFT", f"repair_log.checksums missing {sha}")
        for file_path, expected in files.items():
            entry = repair["checksums"][sha].get(file_path)
            actual = git(["rev-parse", f"{sha}:{file_path}"], cwd=td).stdout.strip()
            if entry != {"status": "match", "expected": expected, "actual": expected} or actual != expected:
                fail("TEST_FAIL", f"{sha}:{file_path}: blob ID mismatch")

manifest = reports["run_manifest"]
if manifest["branches_restored"] != len(expected_refs) or manifest["bundle_created"] is not True:
    fail("CONTRACT_DRIFT", "run_manifest is inconsistent with the repaired bundle")

tool = str(Path("outputs/recovery_tool.py").resolve())
def run_tool(case_root, out, work):
    return subprocess.run([sys.executable, tool, "--case-root", str(case_root), "--out", str(out), "--work", str(work)],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")

with tempfile.TemporaryDirectory() as td:
    base = Path(td)
    partial_out = base / "partial_out"
    partial = run_tool("recovery_cases/partial_overlap", partial_out, base / "partial_work")
    if partial.returncode != 0:
        fail("TEST_FAIL", f"partial-overlap recovery failed: {partial.stderr.strip()}")
    partial_sig, _ = bundle_signature(partial_out / "repaired_repo.bundle")
    partial_refs = read_json("recovery_cases/partial_overlap/expected_refs.json")
    if partial_sig["refs"] != partial_refs:
        fail("TEST_FAIL", "partial-overlap refs differ from contract")

    corrupt_out = base / "corrupt_out"
    corrupt = run_tool("recovery_cases/corrupted_bundle", corrupt_out, base / "corrupt_work")
    if corrupt.returncode == 0 or (corrupt_out / "repaired_repo.bundle").exists():
        fail("INVALID_CASE_ACCEPTED", "corrupted bundle was accepted")
    corrupt_manifest = read_json(corrupt_out / "run_manifest.json")
    if corrupt_manifest.get("error") != "after_bundle_invalid":
        fail("CONTRACT_DRIFT", f"corrupted-bundle case failed for the wrong reason: {corrupt_manifest.get('error')!r}")

    rerun_out = base / "rerun_out"
    rerun = run_tool(".", rerun_out, base / "rerun_work")
    if rerun.returncode != 0:
        fail("NON_DETERMINISTIC_OUTPUT", f"clean rerun failed: {rerun.stderr.strip()}")
    for name in ["repair_log.json", "commit_graph_report.json", "run_manifest.json"]:
        if (rerun_out / name).read_bytes() != (Path("outputs") / name).read_bytes():
            fail("NON_DETERMINISTIC_OUTPUT", f"{name} changed on clean rerun")
    rerun_sig, _ = bundle_signature(rerun_out / "repaired_repo.bundle")
    if rerun_sig != primary_sig:
        fail("NON_DETERMINISTIC_OUTPUT", "bundle signature changed on clean rerun")

case_report = reports["recovery_case_report"]
if case_report["partial_overlap"]["status"] != "PASS" or case_report["corrupted_bundle"]["status"] != "PASS":
    fail("CONTRACT_DRIFT", "recovery_case_report.json does not record both required PASS outcomes")

print("VERIFY PASS: All checks ok")
