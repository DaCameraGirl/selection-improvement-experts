#!/usr/bin/env python3
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
