const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return (result.stdout || "").trim();
}

function copyLooseObject(repoDir, objectStoreDir, sha) {
  const source = path.join(repoDir, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  const target = path.join(objectStoreDir, sha.slice(0, 2), sha.slice(2));
  if (!fs.existsSync(source)) throw new Error(`Loose object missing during generation: ${sha}`);
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function copyObjectRange(repoDir, objectStoreDir, includeSha, excludeSha) {
  const args = ["rev-list", "--objects", includeSha];
  if (excludeSha) args.push(`^${excludeSha}`);
  const rows = runGit(repoDir, args).split(/\r?\n/).filter(Boolean);
  for (const row of rows) copyLooseObject(repoDir, objectStoreDir, row.split(/\s+/, 1)[0]);
}

function copyJsonContracts(fromDir, toDir) {
  for (const name of ["reflog_export.txt", "commit_graph_spec.json", "expected_refs.json", "expected_file_checksums.json"]) {
    fs.copyFileSync(path.join(fromDir, name), path.join(toDir, name));
  }
}

function createScenario(taskDir) {
  const choices = [
    { branch: "release-v2.1", project: "my-app", version: "2.1.0-rc.1", apiHost: "api.example.com" },
    { branch: "release-v3.0", project: "payment-api", version: "3.0.0-rc.2", apiHost: "api.payments.io" },
    { branch: "hotfix/auth", project: "auth-service", version: "1.4.2-fix.1", apiHost: "auth.internal.svc" },
    { branch: "release-v4.2", project: "data-pipeline", version: "4.2.0-beta.3", apiHost: "pipeline.prod.net" },
    { branch: "release-v1.9", project: "billing-svc", version: "1.9.1-rc.3", apiHost: "billing.company.io" },
  ];
  const scenario = choices[Math.floor(Math.random() * choices.length)];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "git-recovery-v2-"));
  try {
    runGit(tmp, ["init"]);
    runGit(tmp, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    runGit(tmp, ["config", "user.name", "Generator"]);
    runGit(tmp, ["config", "user.email", "gen@example.com"]);

    function commit(files, message) {
      for (const [rel, content] of Object.entries(files)) {
        const file = path.join(tmp, rel);
        ensureDir(path.dirname(file));
        fs.writeFileSync(file, content);
      }
      runGit(tmp, ["add", "-A"]);
      runGit(tmp, ["commit", "-m", message]);
      return runGit(tmp, ["rev-parse", "HEAD"]);
    }

    const nonce = crypto.randomUUID();
    const shaA = commit({
      "README.md": `# Git Force-Push Recovery\n\nProject: ${scenario.project}\nBuild: ${nonce}\n`,
      ".gitignore": "node_modules/\n.DS_Store\n",
      "src/config.ts": `export const API_URL = 'https://${scenario.apiHost}';\nexport const TIMEOUT = 5000;\n`,
    }, "Set up CI/CD pipeline for staging deploy");
    const shaB = commit({
      "src/handler.ts": "export function handle(req) {\n  return { status: 200, body: req };\n}\n",
      "src/db.ts": "export const pool = new Map();\n",
    }, "Refactor database connection pooling");

    runGit(tmp, ["checkout", "-b", scenario.branch, shaA]);
    const shaC = commit({
      "src/config.ts": `export const API_URL = 'https://${scenario.apiHost}';\nexport const TIMEOUT = 5000;\nexport const RATE_LIMIT = 100;\n`,
    }, "Add rate-limiting config for payment gateway");
    const shaD = commit({
      "package.json": JSON.stringify({ name: scenario.project, version: scenario.version }, null, 2) + "\n",
    }, `Bump version to ${scenario.version}`);
    const shaE = commit({
      "src/transaction.ts": "export function processTx(tx) {\n  if (!tx) throw new Error('null tx');\n  return { id: tx.id, status: 'processed' };\n}\n",
    }, "Fix null-pointer in transaction handler");
    const shaF = commit({
      "src/handler.ts": "export function handle(req) {\n  if (!req.user) return { status: 401 };\n  return { status: 200, body: req };\n}\n",
    }, `Merge feature/urgent-fix into ${scenario.branch}`);
    const short = (sha) => sha.slice(0, 7);

    const reflog = [
      `${short(shaF)} HEAD@{0}: commit: Merge feature/urgent-fix into ${scenario.branch}`,
      `${short(shaE)} HEAD@{1}: commit: Fix null-pointer in transaction handler`,
      `${short(shaD)} HEAD@{2}: commit: Bump version to ${scenario.version}`,
      `${short(shaC)} HEAD@{3}: commit: Add rate-limiting config for payment gateway`,
      `${short(shaB)} HEAD@{4}: commit: Refactor database connection pooling`,
      `${short(shaA)} HEAD@{5}: commit: Set up CI/CD pipeline for staging deploy`,
      `${short(shaE)} HEAD@{6}: duplicate evidence line used to test first-seen deduplication`,
    ].join("\n") + "\n";
    const graphSpec = {
      description: "Expected branch topology after recovery. Ancestor arrays are ordered exactly as git rev-list must report them.",
      branches: {
        [`refs/heads/${scenario.branch}`]: {
          expected_tip: short(shaF),
          expected_ancestors: [short(shaF), short(shaE), short(shaD), short(shaC), short(shaA)],
        },
        "refs/heads/main": {
          expected_tip: short(shaB),
          expected_ancestors: [short(shaB), short(shaA)],
        },
      },
    };
    const expectedRefs = {
      [`refs/heads/${scenario.branch}`]: shaF,
      "refs/heads/main": shaB,
    };
    const checksums = {
      [short(shaC)]: { "src/config.ts": runGit(tmp, ["rev-parse", `${shaC}:src/config.ts`]) },
      [short(shaD)]: { "package.json": runGit(tmp, ["rev-parse", `${shaD}:package.json`]) },
      [short(shaE)]: { "src/transaction.ts": runGit(tmp, ["rev-parse", `${shaE}:src/transaction.ts`]) },
    };

    fs.writeFileSync(path.join(taskDir, "reflog_export.txt"), reflog);
    writeJson(path.join(taskDir, "commit_graph_spec.json"), graphSpec);
    writeJson(path.join(taskDir, "expected_refs.json"), expectedRefs);
    writeJson(path.join(taskDir, "expected_file_checksums.json"), checksums);

    const primaryObjects = path.join(taskDir, "orphaned_object_store", ".git", "objects");
    ensureDir(primaryObjects);
    fs.writeFileSync(path.join(taskDir, "orphaned_object_store", ".git", "HEAD"), "ref: refs/heads/recovery\n");
    fs.cpSync(path.join(tmp, ".git", "objects"), primaryObjects, { recursive: true });
    runGit(tmp, ["checkout", "main"]);
    runGit(tmp, ["bundle", "create", path.join(taskDir, "repo_after_force.bundle"), "main"]);

    const partial = path.join(taskDir, "recovery_cases", "partial_overlap");
    ensureDir(partial);
    runGit(tmp, ["branch", "overlap-base", shaD]);
    runGit(tmp, ["bundle", "create", path.join(partial, "repo_after_force.bundle"), "main", "overlap-base"]);
    const partialObjects = path.join(partial, "orphaned_object_store", ".git", "objects");
    ensureDir(partialObjects);
    fs.writeFileSync(path.join(partial, "orphaned_object_store", ".git", "HEAD"), "ref: refs/heads/recovery\n");
    copyObjectRange(tmp, partialObjects, shaF, shaD);
    copyJsonContracts(taskDir, partial);

    const corrupt = path.join(taskDir, "recovery_cases", "corrupted_bundle");
    ensureDir(path.join(corrupt, "orphaned_object_store", ".git", "objects"));
    fs.writeFileSync(path.join(corrupt, "orphaned_object_store", ".git", "objects", ".gitkeep"), "");
    fs.writeFileSync(path.join(corrupt, "orphaned_object_store", ".git", "HEAD"), "ref: refs/heads/recovery\n");
    fs.writeFileSync(path.join(corrupt, "repo_after_force.bundle"), "corrupted bundle fixture\n");
    copyJsonContracts(taskDir, corrupt);

    return { ...scenario, shaA, shaB, shaC, shaD, shaE, shaF };
  } finally {
    removeDir(tmp);
  }
}

function recoveryToolSource() {
  return String.raw`#!/usr/bin/env python3
"""Offline Git ref recovery utility used by the task solution."""
import argparse, json, os, platform, re, shutil, stat, subprocess, sys
from pathlib import Path

GIT = "git.exe" if platform.system() == "Windows" else "git"

def git(args, cwd=None):
    return subprocess.run([GIT] + args, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")

def remove_tree(path):
    path = Path(path)
    def onerror(func, item, exc_info):
        try:
            os.chmod(item, stat.S_IWRITE)
            func(item)
        except Exception:
            pass
    if path.exists():
        shutil.rmtree(path, onerror=onerror)

def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

def failed(out, error, details):
    bundle = out / "repaired_repo.bundle"
    if bundle.exists():
        bundle.unlink()
    write_json(out / "run_manifest.json", {
        "solver": "recovery_tool.py", "status": "failed", "error": error,
        "details": details
    })
    return 1

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--case-root", default=".")
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--work", default="recovery_worktree")
    args = ap.parse_args()
    root, out, work = Path(args.case_root), Path(args.out), Path(args.work)
    out.mkdir(parents=True, exist_ok=True)
    for name in ["repaired_repo.bundle", "repair_log.json", "commit_graph_report.json", "run_manifest.json"]:
        target = out / name
        if target.exists():
            target.unlink()
    remove_tree(work)

    required = ["repo_after_force.bundle", "reflog_export.txt", "commit_graph_spec.json",
                "expected_refs.json", "expected_file_checksums.json"]
    missing = [name for name in required if not (root / name).exists()]
    object_dir = root / "orphaned_object_store" / ".git" / "objects"
    if missing or not object_dir.exists():
        return failed(out, "missing_input", ", ".join(missing) or str(object_dir))

    clone = git(["clone", str((root / "repo_after_force.bundle").resolve()), str(work.resolve())])
    if clone.returncode != 0:
        return failed(out, "after_bundle_invalid", clone.stderr.strip())

    dest_objects = work / ".git" / "objects"
    for item in object_dir.iterdir():
        dest = dest_objects / item.name
        if item.is_dir():
            shutil.copytree(item, dest, dirs_exist_ok=True)
        elif item.is_file():
            shutil.copy2(item, dest)
    git(["fsck", "--lost-found"], cwd=work)

    refs = json.loads((root / "expected_refs.json").read_text(encoding="utf-8"))
    spec = json.loads((root / "commit_graph_spec.json").read_text(encoding="utf-8"))
    expected_checksums = json.loads((root / "expected_file_checksums.json").read_text(encoding="utf-8"))
    reflog_shas, seen = [], set()
    for line in (root / "reflog_export.txt").read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([a-f0-9]{7,40})\s", line)
        if match and match.group(1)[:7] not in seen:
            seen.add(match.group(1)[:7])
            reflog_shas.append(match.group(1)[:7])

    restored = {}
    for ref, sha in refs.items():
        if git(["cat-file", "-e", sha], cwd=work).returncode != 0:
            continue
        if git(["update-ref", ref, sha], cwd=work).returncode == 0:
            restored[ref] = sha
    existing = git(["for-each-ref", "--format=%(refname)", "refs/heads"], cwd=work)
    for ref in existing.stdout.splitlines():
        if ref and ref not in refs:
            git(["update-ref", "-d", ref], cwd=work)

    graph = {"branches": {}}
    for ref, info in spec.get("branches", {}).items():
        tip = info["expected_tip"]
        rev = git(["rev-list", tip], cwd=work)
        found = [sha[:7] for sha in rev.stdout.splitlines() if sha.strip()]
        expected = [sha[:7] for sha in info.get("expected_ancestors", [])]
        graph["branches"][ref] = {
            "tip": tip, "expected_ancestors": expected, "found_ancestors": found,
            "all_reachable": rev.returncode == 0 and found[:len(expected)] == expected
        }
    write_json(out / "commit_graph_report.json", graph)

    checksum_results = {}
    for sha, files in expected_checksums.items():
        checksum_results[sha] = {}
        for file_path, expected in files.items():
            rev = git(["rev-parse", f"{sha}:{file_path}"], cwd=work)
            actual = rev.stdout.strip() if rev.returncode == 0 else None
            checksum_results[sha][file_path] = {
                "status": "match" if actual == expected else ("file_not_found" if actual is None else "mismatch"),
                "expected": expected, "actual": actual
            }

    fsck = git(["fsck", "--connectivity-only"], cwd=work)
    fsck_text = fsck.stdout + fsck.stderr
    connectivity = fsck.returncode == 0 and not re.search(r"\b(missing|corrupt|broken|error:)\b", fsck_text, re.I)
    bundle = git(["bundle", "create", str((out / "repaired_repo.bundle").resolve()), "--all"], cwd=work)
    bundle_ok = bundle.returncode == 0
    repair_log = {
        "branches_restored": list(restored.keys()), "refs_expected": refs,
        "refs_restored": restored, "all_refs_restored": restored == refs,
        "orphaned_shas": reflog_shas, "bundle_created": bundle_ok,
        "checksums": checksum_results
    }
    write_json(out / "repair_log.json", repair_log)
    write_json(out / "run_manifest.json", {
        "solver": "recovery_tool.py", "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "branches_restored": len(restored), "bundle_created": bundle_ok
    })
    valid = connectivity and bundle_ok and restored == refs
    valid = valid and all(item["all_reachable"] for item in graph["branches"].values())
    valid = valid and all(entry["status"] == "match" for files in checksum_results.values() for entry in files.values())
    return 0 if valid else 1

if __name__ == "__main__":
    sys.exit(main())
`;
}

function solveSource() {
  return String.raw`#!/usr/bin/env python3
"""Reference wrapper: install the reusable tool and exercise every required case."""
import json, shutil, subprocess, sys
from pathlib import Path

def run_tool(tool, root, out, work):
    return subprocess.run([sys.executable, str(tool), "--case-root", str(root), "--out", str(out), "--work", str(work)],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")

def git(args, cwd=None):
    return subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")

out = Path("outputs")
out.mkdir(exist_ok=True)
tool = out / "recovery_tool.py"
shutil.copy2("recovery_tool.py", tool)
case_runs = Path("case_runs")
if case_runs.exists():
    shutil.rmtree(case_runs)
case_runs.mkdir()

primary = run_tool(tool.resolve(), ".", out, "recovery_worktree")
if primary.returncode != 0:
    print(primary.stdout, primary.stderr)
    sys.exit(primary.returncode)

partial_out = case_runs / "partial_overlap_outputs"
partial = run_tool(tool.resolve(), "recovery_cases/partial_overlap", partial_out, case_runs / "partial_overlap_work")
partial_bundle = partial_out / "repaired_repo.bundle"
partial_clone_ok = False
partial_fsck_ok = False
if partial.returncode == 0 and partial_bundle.exists():
    clone_dir = case_runs / "partial_overlap_clone"
    clone = git(["clone", str(partial_bundle.resolve()), str(clone_dir)])
    partial_clone_ok = clone.returncode == 0
    partial_fsck_ok = partial_clone_ok and git(["fsck", "--connectivity-only"], cwd=clone_dir).returncode == 0

corrupt_out = case_runs / "corrupted_bundle_outputs"
corrupt = run_tool(tool.resolve(), "recovery_cases/corrupted_bundle", corrupt_out, case_runs / "corrupted_bundle_work")
corrupt_repaired = (corrupt_out / "repaired_repo.bundle").exists()
corrupt_manifest_path = corrupt_out / "run_manifest.json"
corrupt_manifest = json.loads(corrupt_manifest_path.read_text(encoding="utf-8")) if corrupt_manifest_path.exists() else {}

report = {
    "partial_overlap": {
        "status": "PASS" if partial.returncode == 0 and partial_clone_ok and partial_fsck_ok else "FAIL",
        "tool_exit_code": partial.returncode, "bundle_cloneable": partial_clone_ok,
        "fsck_connectivity": partial_fsck_ok
    },
    "corrupted_bundle": {
        "status": "PASS" if corrupt.returncode != 0 and not corrupt_repaired and corrupt_manifest.get("error") == "after_bundle_invalid" else "FAIL",
        "tool_exit_code": corrupt.returncode, "rejected": corrupt.returncode != 0,
        "repaired_bundle_created": corrupt_repaired,
        "error": corrupt_manifest.get("error", "")
    }
}
(out / "recovery_case_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
sys.exit(0 if all(case["status"] == "PASS" for case in report.values()) else 1)
`;
}

function verifySource() {
  return String.raw`#!/usr/bin/env python3
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
`;
}

function schemas() {
  const sha40 = "^[a-f0-9]{40}$";
  const sha7 = "^[a-f0-9]{7}$";
  return {
    "repair_log.schema.json": {
      type: "object",
      required: ["branches_restored", "refs_expected", "refs_restored", "all_refs_restored", "orphaned_shas", "bundle_created", "checksums"],
      properties: {
        branches_restored: { type: "array", items: { type: "string", pattern: "^refs/heads/" } },
        refs_expected: { type: "object", additionalProperties: { type: "string", pattern: sha40 } },
        refs_restored: { type: "object", additionalProperties: { type: "string", pattern: sha40 } },
        all_refs_restored: { type: "boolean" },
        orphaned_shas: { type: "array", items: { type: "string", pattern: sha7 } },
        bundle_created: { type: "boolean" },
        checksums: { type: "object", additionalProperties: { type: "object", additionalProperties: {
          type: "object", required: ["status", "expected", "actual"], properties: {
            status: { type: "string", enum: ["match", "mismatch", "file_not_found"] },
            expected: { type: "string", pattern: sha40 },
            actual: { type: ["string", "null"] },
          }, additionalProperties: false,
        } } },
      },
      additionalProperties: false,
    },
    "commit_graph_report.schema.json": {
      type: "object", required: ["branches"], properties: {
        branches: { type: "object", additionalProperties: {
          type: "object", required: ["tip", "expected_ancestors", "found_ancestors", "all_reachable"],
          properties: {
            tip: { type: "string", pattern: sha7 },
            expected_ancestors: { type: "array", items: { type: "string", pattern: sha7 } },
            found_ancestors: { type: "array", items: { type: "string", pattern: sha7 } },
            all_reachable: { type: "boolean" },
          }, additionalProperties: false,
        } },
      }, additionalProperties: false,
    },
    "run_manifest.schema.json": {
      type: "object", required: ["solver", "python", "branches_restored", "bundle_created"],
      properties: {
        solver: { type: "string", minLength: 1 }, python: { type: "string", minLength: 1 },
        branches_restored: { type: "integer", minimum: 0 }, bundle_created: { type: "boolean" },
      }, additionalProperties: false,
    },
    "recovery_case_report.schema.json": {
      type: "object", required: ["partial_overlap", "corrupted_bundle"], properties: {
        partial_overlap: { type: "object", required: ["status", "tool_exit_code", "bundle_cloneable", "fsck_connectivity"],
          properties: { status: { type: "string", enum: ["PASS", "FAIL"] }, tool_exit_code: { type: "integer" },
            bundle_cloneable: { type: "boolean" }, fsck_connectivity: { type: "boolean" } }, additionalProperties: false },
        corrupted_bundle: { type: "object", required: ["status", "tool_exit_code", "rejected", "repaired_bundle_created", "error"],
          properties: { status: { type: "string", enum: ["PASS", "FAIL"] }, tool_exit_code: { type: "integer" },
            rejected: { type: "boolean" }, repaired_bundle_created: { type: "boolean" },
            error: { type: "string", enum: ["after_bundle_invalid"] } }, additionalProperties: false },
      }, additionalProperties: false,
    },
  };
}

function checksumPath(root, rel) {
  const target = path.join(root, rel);
  const hash = crypto.createHash("sha256");
  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const next = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, next);
      else {
        hash.update(next);
        hash.update(fs.readFileSync(full));
      }
    }
  }
  if (fs.statSync(target).isDirectory()) walk(target, "");
  else hash.update(fs.readFileSync(target));
  return hash.digest("hex");
}

function generateGitPackageV2(taskDir, fields, runtimes) {
  ensureDir(taskDir);
  const scenario = createScenario(taskDir);
  ensureDir(path.join(taskDir, "output_schemas"));
  for (const [name, schema] of Object.entries(schemas())) {
    writeJson(path.join(taskDir, "output_schemas", name), schema);
  }
  fs.writeFileSync(path.join(taskDir, "recovery_tool.py"), recoveryToolSource());
  fs.writeFileSync(path.join(taskDir, "solve.py"), solveSource());
  fs.writeFileSync(path.join(taskDir, "verify.py"), verifySource());

  const manifest = {
    generator: "selection-improvement-runner",
    generator_version: "2026-05-31-git-recovery-cases",
    generated_at: new Date().toISOString(),
    domain: "git",
    variant: { branch: scenario.branch, project: scenario.project },
    runtimes,
  };
  writeJson(path.join(taskDir, "version_manifest.json"), manifest);

  const checksumFiles = [
    "orphaned_object_store/.git/objects", "repo_after_force.bundle", "reflog_export.txt",
    "commit_graph_spec.json", "expected_refs.json", "expected_file_checksums.json",
    "output_schemas", "recovery_cases", "version_manifest.json",
  ];
  const rows = checksumFiles.map((rel) => `| \`${rel}\` | ${checksumPath(taskDir, rel)} |`);
  fs.writeFileSync(path.join(taskDir, "README.md"), [
    "# Git Force-Push Recovery",
    "",
    "## Objective",
    "Restore exact Git refs after an accidental force push. The workflow must run without network access after unpacking.",
    "",
    "## Primary inputs",
    "| Path | Role |",
    "|---|---|",
    "| `repo_after_force.bundle` | Surviving remote state after the force push |",
    "| `orphaned_object_store/.git/objects` | Dangling loose objects recovered from another local clone |",
    "| `reflog_export.txt` | Reflog-style evidence; preserve each leading SHA once in first-seen order |",
    "| `expected_refs.json` | Exact branch ref targets |",
    "| `commit_graph_spec.json` | Exact expected ancestry |",
    "| `expected_file_checksums.json` | Expected Git blob IDs |",
    "| `output_schemas/` | JSON contracts for required reports |",
    "",
    "## Required recovery cases",
    "| Path | Required behavior |",
    "|---|---|",
    "| `recovery_cases/partial_overlap/` | Recover successfully by combining the bundle with loose objects; neither source is sufficient by itself |",
    "| `recovery_cases/corrupted_bundle/` | Reject the corrupt bundle with `error=after_bundle_invalid`; do not emit a successful repaired bundle |",
    "",
    "## Deliverables",
    "- `outputs/recovery_tool.py`",
    "- `outputs/repaired_repo.bundle`",
    "- `outputs/repair_log.json`",
    "- `outputs/commit_graph_report.json`",
    "- `outputs/recovery_case_report.json`",
    "- `outputs/run_manifest.json`",
    "",
    "## Provenance",
    "All repository content and fixtures are synthetic and generated locally for this offline recovery scenario.",
    "",
    "## SHA-256 checksums",
    "| Path | SHA-256 |",
    "|---|---|",
    ...rows,
  ].join("\n") + "\n");
}

module.exports = { generateGitPackageV2 };
