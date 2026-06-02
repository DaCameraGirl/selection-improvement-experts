#!/usr/bin/env python3
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
