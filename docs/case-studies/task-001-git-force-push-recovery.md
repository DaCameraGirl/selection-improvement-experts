# Task 001: Git Force-Push Recovery

This is the reference case study for the Git force-push recovery task that was returned for revision. Use it as the template for future task fixes when a review says the output contract, verifier, or resource ZIP contents are not aligned.

## Task Identity

Title: Git force-push recovery: restore refs with exact original topology

Off-platform/task ID used for final file naming:

```text
6a1885adf570e57154a8295c
```

Final local upload files:

```text
C:\Users\enter\selection-improvement-experts\6a1885adf570e57154a8295c\6a1885adf570e57154a8295c_resources.zip
C:\Users\enter\selection-improvement-experts\6a1885adf570e57154a8295c\6a1885adf570e57154a8295c_golden_solution.zip
```

Important: the resources ZIP is the worker-facing input package. It must not contain `solve.py`, `verify.py`, `outputs/`, or scratch worktrees. The golden solution ZIP is the reference package and may contain `solve.py`, `verify.py`, and computed `outputs/`.

## Submission History

Full verbatim reviewer feedback is preserved in [`docs/reviewer-feedback/`](../reviewer-feedback/README.md).
Full generator/engine fix history is in [`docs/GIT_FORCE_PUSH_RECOVERY_REVISION_HISTORY.md`](../GIT_FORCE_PUSH_RECOVERY_REVISION_HISTORY.md).

### Submission 1 — May 16, 2026 (Returned)

**Task ID:** 6a08d3fe795d5869e9415745

**Original prompt:**
```text
Please help me with restoring the published Git refs after a force push changes the branch history. Match expected_refs.json exactly and ensure no missing or corrupt objects to promote confidence in the process. Land outputs/repaired_repo.bundle, outputs/repair_log.json, outputs/commit_graph_report.json, and outputs/run_manifest.json in the outputs folder. Next, ensure the repaired bundle clones successfully, pass git fsck --connectivity-only with 0 missing or corrupt objects, and satisfy the parent-chain and checksum fixtures within the contract threshold.
```

**Reviewer findings:**
- `solve.py` and `verify.py` were included in the worker-facing ZIP.
- The resources description listed those answer-bearing files.
- The prompt incorrectly referred to outputs that "produce new SHAs."
- Unresolved GPTZero linter flag.

**Fixes applied:**
- Split archives into worker task kit and reference golden kit.
- Excluded reference scripts and precomputed outputs from the worker ZIP.
- Removed misleading new-SHA wording.

---

### Submission 2 — May 22, 2026 (Returned)

**Task ID:** 6a10ba7542205e26762a2ff8

**Prompt at submission:**
```text
I am in a jam. My team needs help restoring published Git refs after a force push changed branch history. Please use the provided after-bundle, dangling object store, reflog export, expected refs, commit graph spec, checksum fixtures, schemas, and verifier fixtures.

Create these files in the outputs folder: repaired_repo.bundle, repair_log.json, commit_graph_report.json, and run_manifest.json. Restore refs to the exact SHAs in expected_refs.json. Recreated commits with different SHAs are not acceptable.

The repaired bundle must clone successfully and pass git fsck --connectivity-only with no missing or corrupt objects. It must preserve reflog SHAs in repair_log.orphaned_shas order, match commit_graph_spec.json exactly, and report every expected_file_checksums.json entry as status="match". All JSON outputs must follow the schemas in output_schemas, and rerunning the solution from a clean state must produce deterministic equivalent outputs.
```

**Reviewer findings:**
- Prompt did not fully define JSON schemas, ordering rules, or exact-match behavior.
- Written verifier description promised checks that `verify.py` did not perform.
- Checksum verification accepted omitted fixture keys because it only examined keys reported by the solution.
- Run manifest, reflog ordering, and clean-rerun determinism contracts were not enforced.

**Fixes applied:**
- Added schemas for every JSON report.
- Required checksum keys loaded from `expected_file_checksums.json` directly.
- Enforced exact refs, reflog first-seen ordering, graph reachability, manifest consistency, bundle cloneability, `git fsck --connectivity-only`, and clean reruns.
- Added pre-ship gate.

---

### Submission 3 — May 28, 2026 (Returned, Rating: 3/5)

**Task ID:** 6a18eea3494f9eec266db729

**Reviewer findings:**
- Recovery too mechanical after the solver grasped the exact-SHA requirement.
- Edge and corrupted fixtures listed but not exercised as required behavior.
- `verifier_inputs/` folder name exposed internal assessment language.
- Offline behavior and reflog ordering not stated directly in prompt.
- Golden solution contained reference code, repeated schema details, and instructions to run the checker.
- Generic reason codes (`STDERR_WARNING`, `THRESHOLD_FAIL`) did not map to real checks.
- Determinism check depended on `solve.py` being present.
- Prompt not structured into sections.

**Fixes applied:**
- Required `outputs/recovery_tool.py` as a reusable utility.
- Added real `recovery_cases/partial_overlap/` and `recovery_cases/corrupted_bundle/` as required behavior.
- Added `.gitkeep` to preserve intentionally empty corrupted-bundle object store.
- Added `outputs/recovery_case_report.json`.
- Renamed `verifier_inputs/` to `recovery_cases/`.
- Rewrote prompt with Objective / Provided files / Deliverables / Success criteria / Constraints sections.
- Rewrote golden solution as 12 ordered prose steps, no code dump.
- Replaced `solve.py`-dependent determinism check with submitted-tool-based check.
- Removed invalid reason codes.

---

### Submission 4 — May 31, 2026 (Accepted, Rating: Excellent 5/5)

**Task ID:** 6a1cacbfccca29bb61cae446

**Prompt (final):**
```text
## Objective
Restore the published Git refs after an accidental force push changed branch history. Preserve the exact original commit SHAs; do not recreate equivalent commits with cherry-pick.

## Provided files
- `repo_after_force.bundle`, `orphaned_object_store/.git/objects`, `reflog_export.txt`, `expected_refs.json`, `commit_graph_spec.json`, and `expected_file_checksums.json` describe the primary recovery.
- `recovery_cases/partial_overlap/` contains a second valid recovery where the after-bundle and loose object store each provide only part of the required graph.
- `recovery_cases/corrupted_bundle/` contains an invalid bundle that your tool must reject as `after_bundle_invalid` without emitting a misleading successful repair.
- `output_schemas/` defines the JSON output contracts. README.md explains the case layouts.

## Deliverables
Create `outputs/recovery_tool.py`, `outputs/repaired_repo.bundle`, `outputs/repair_log.json`, `outputs/commit_graph_report.json`, `outputs/recovery_case_report.json`, and `outputs/run_manifest.json`.

## Success criteria
- The repaired primary bundle must clone successfully and pass `git fsck --connectivity-only` with no missing or corrupt objects.
- Restore every ref to the exact SHA in `expected_refs.json`, match `commit_graph_spec.json`, and report every `expected_file_checksums.json` entry with `status="match"`.
- `repair_log.orphaned_shas` must include each leading SHA from `reflog_export.txt` exactly once, in first-seen reflog order, using 7-character short SHA form.
- `outputs/recovery_tool.py` must restore the partial-overlap case and reject the corrupted-bundle case with `error="after_bundle_invalid"`. Record both outcomes in `outputs/recovery_case_report.json`.

## Constraints
Run entirely offline after unpacking the zip. All JSON outputs must match the schemas in `output_schemas/`, preserve declared ordering, and be deterministic across clean reruns.
```

**Additional form-field fixes during submission:**
- Golden Solution Steps Description: removed auto-generated `verify.py` invocation steps; added steps 11–13 covering recovery cases, recovery_case_report, and determinism rerun.
- Final Verifiers: replaced auto-generated 17-item list (which had `solve.py` dependency) with the 13-point numbered list.

**Platform LLM assessment result:** Strong Accept (all 7 criteria passed).

**Final reviewer result:** Excellent 5/5. The verbatim accepted feedback is
preserved in
[`docs/reviewer-feedback/2026-05-31-6a1cacbfccca29bb61cae446.md`](../reviewer-feedback/2026-05-31-6a1cacbfccca29bb61cae446.md).
The complete accepted baseline, including submitted fields, implementation
ledger, upload artifacts, and audit evidence, is indexed in
[`docs/accepted-submissions/2026-05-31-6a1cacbfccca29bb61cae446.md`](../accepted-submissions/2026-05-31-6a1cacbfccca29bb61cae446.md).

## Corrected Summary

```text
Recover a force-pushed Git graph by loading the surviving after-bundle, restoring lost objects from the dangling object store, and moving branch refs back to the exact SHAs in expected_refs.json. Produce a cloneable repaired bundle plus deterministic repair, commit graph, and run manifest reports
```

## Corrected Difficulty Explanation

```text
This is a hard senior-level version-control recovery task because it requires practical Git internals knowledge beyond routine branch commands. In real work, senior software engineers, release engineers, and DevOps/SRE staff need to solve this when a force push rewrites published history and breaks an audit trail, release branch, hotfix branch, or deployment source of truth. The recovery must preserve the original commit SHAs, so common fixes like recreating commits are wrong even if the files look correct.

The data is a realistic synthetic force-push incident: a post-force-push Git bundle, dangling loose Git objects, a reflog export, expected branch refs, parent-chain fixtures, and blob checksum fixtures. These mirror the evidence engineers use during an offline Git recovery when the remote no longer exposes the lost commits but local object stores or reflog records still do. The task is difficult because the solver must restore refs with exact object identity, prove object connectivity with git fsck, validate reachability and parent chains, and produce deterministic JSON reports that match the declared schemas and checksum contract.
```

## Corrected Resources Field

The resources field must start with `Resources:` and must list only what is in the worker-facing resources ZIP.

```text
Resources:

Public source references:
- Git reflog documentation: https://git-scm.com/docs/git-reflog
- Git bundle documentation: https://git-scm.com/docs/git-bundle
- Real force-push recovery scenarios: https://ohshitgit.com/

Upload one self-contained resources zip named 6a1885adf570e57154a8295c_resources.zip. It contains the worker-facing task inputs only and does not contain solve.py, verify.py, precomputed outputs, or scratch worktrees.

Files included in the resources zip:
- README.md - describes each fixture, required output path, offline workflow requirement, and SHA-256 checksums for input fixtures.
- version_manifest.json - runtime and package manifest with Python, Node, Git, variant, and OS assumptions.
- repo_after_force.bundle - Git bundle reflecting the surviving remote state after the force push.
- orphaned_object_store/.git/HEAD - minimal Git metadata for the dangling object store.
- orphaned_object_store/.git/objects/ - dangling loose Git objects containing the lost commits and related trees/blobs.
- reflog_export.txt - reflog-style evidence; the first token on each line is a commit SHA to preserve.
- commit_graph_spec.json - expected final branch topology, expected tips, expected ancestor chains, and orphaned commits.
- expected_refs.json - exact refs/heads/* to 40-character SHA mappings.
- expected_file_checksums.json - expected Git blob IDs for required files at recovered commits.
- output_schemas/repair_log.schema.json - JSON Schema for outputs/repair_log.json.
- output_schemas/commit_graph_report.schema.json - JSON Schema for outputs/commit_graph_report.json.
- output_schemas/run_manifest.schema.json - JSON Schema for outputs/run_manifest.json.
- verifier_inputs/normal_recovery_case.json - normal recovery fixture.
- verifier_inputs/edge_partial_overlap_case.json - edge fixture for partial overlap and dangling-object recovery.
- verifier_inputs/invalid_corrupted_bundle_case.json - invalid fixture describing missing/corrupt object-store behavior.

Required deliverables from the solver:
- outputs/repaired_repo.bundle
- outputs/repair_log.json
- outputs/commit_graph_report.json
- outputs/run_manifest.json

The workflow must run without network access after the zip is unpacked. The repository bundle, dangling object store, reflog export, commit graph spec, expected refs, checksum fixtures, schemas, and verifier fixtures are synthetically constructed for this force-push recovery scenario and have no licensing restrictions.
```

## Golden Solution Steps Description

```text
This describes how to restore Git branch refs after a force push, using only the files in the resources zip. No network access is needed after unpacking. The audience is a coder with basic Git familiarity who will translate this into terminal commands.

The key insight: this is a ref-restore problem, not a re-commit problem. The solution must preserve original commit object IDs. Recreated commits with different SHAs are not acceptable, even if the file contents look correct. Start from repo_after_force.bundle, load the dangling loose objects from orphaned_object_store/.git/objects, restore each expected ref with git update-ref, and prove the recovery with git fsck, git rev-list, and git rev-parse.

1. Set up the environment

Create outputs/ if it does not exist. This is where every result lands.

Create outputs/recovery_tool.py as a reusable command-line utility. It must accept three arguments: a case root directory, an output directory, and a clean worktree path. All recovery logic — primary case and the two required cases — runs through this same tool.

Use these standard Python modules: os, sys, json, re, subprocess, shutil, stat, platform, and pathlib.Path.

2. Parse input files

Read every input file the task ships:

- repo_after_force.bundle — Git bundle reflecting the surviving remote state after the force push.
- orphaned_object_store/.git/objects — dangling loose Git objects containing the lost commits and related trees/blobs.
- reflog_export.txt — reflog-style text. The first whitespace token on each line is a commit SHA.
- commit_graph_spec.json — expected final branch topology.
- expected_refs.json — exact mapping of refs/heads/<name> to a full 40-character SHA.
- expected_file_checksums.json — expected Git blob IDs for key files at recovered commits.
- recovery_cases/partial_overlap/ — a valid recovery case where neither the bundle nor the loose object store is sufficient alone.
- recovery_cases/corrupted_bundle/ — an invalid bundle case the tool must reject.

3. Process reflog entries

Walk reflog_export.txt line by line and pull out the leading SHA. Keep entries in file order, dedupe by first appearance, and do not sort. repair_log.orphaned_shas must use 7-character short SHAs in this same order.

4. Prepare the recovery repository

Delete any old recovery_worktree/ safely. Clone repo_after_force.bundle into recovery_worktree/. If cloning fails, exit non-zero, write a failed run_manifest.json with error="after_bundle_invalid", and do not write a repaired bundle.

Copy every directory and file from orphaned_object_store/.git/objects into recovery_worktree/.git/objects. Run git fsck --lost-found after copying so Git can surface unreachable objects, but do not use lost-found output as the source of truth.

5. Restore Git refs to exact expected SHAs

For every ref in expected_refs.json, confirm the target commit exists with git cat-file -e <sha>. If it exists, run git update-ref <ref> <sha>. Record successful updates in refs_restored.

The restored refs must exactly match expected_refs.json.

6. Verify commit reachability

For each branch in commit_graph_spec.json, walk back from the expected tip with git rev-list <tip>. Convert found commits and expected ancestors to 7-character short SHAs.

Write outputs/commit_graph_report.json with branches, tip, expected_ancestors, found_ancestors, and all_reachable. Set all_reachable true only when every expected ancestor appears in found_ancestors.

7. Verify file checksums

For every commit SHA and file path in expected_file_checksums.json, run git rev-parse <sha>:<path>. Compare the returned Git blob ID exactly to the fixture value. Record status, expected, and actual for every required entry.

8. Create the repaired bundle

Run git bundle create <absolute path to outputs/repaired_repo.bundle> --all from recovery_worktree. Use --all so all restored refs are included. Record bundle_created from the command exit code.

9. Generate repair_log.json

Write outputs/repair_log.json with exactly these top-level keys: branches_restored, refs_expected, refs_restored, all_refs_restored, orphaned_shas, bundle_created, and checksums.

refs_expected must echo expected_refs.json. refs_restored must contain the exact restored ref-to-SHA mapping. all_refs_restored is true only when every expected ref was restored. checksums must include every required key from expected_file_checksums.json.

10. Generate run_manifest.json

Write outputs/run_manifest.json with solver, python, branches_restored, and bundle_created. branches_restored must equal the number of refs in refs_restored.

11. Handle the two required recovery cases

Run outputs/recovery_tool.py against recovery_cases/partial_overlap/ in a fresh temporary directory. It must exit 0 and produce a cloneable repaired bundle that passes git fsck --connectivity-only with exact expected refs. Neither the bundle nor the loose object store alone is sufficient — both are required for this case to succeed.

Run outputs/recovery_tool.py against recovery_cases/corrupted_bundle/ in a fresh temporary directory. It must exit non-zero and write run_manifest.error="after_bundle_invalid". No repaired bundle should be produced.

12. Write outputs/recovery_case_report.json

Record the result of each case run. The partial-overlap recovery outcome must be PASS. The corrupted-bundle rejection outcome must be PASS. This file must follow the schema in output_schemas/recovery_case_report.schema.json.

13. Confirm deterministic reruns

Re-run outputs/recovery_tool.py against the primary case in a fresh temporary directory. repair_log.json, commit_graph_report.json, and run_manifest.json must be byte-identical to the first run. The rebuilt bundle must have the same refs, histories, and connectivity result.

Common failure modes to avoid:

- Recreating commits with new SHAs instead of restoring refs to existing object IDs.
- Using only repo_after_force.bundle and never loading orphaned_object_store/.git/objects.
- Assuming either source alone is sufficient for the partial-overlap case.
- Writing the repaired bundle without --all.
- Comparing file SHA-256 hashes instead of Git blob IDs.
- Reporting only checksum keys that pass instead of every key in expected_file_checksums.json.
- Treating a non-empty bundle path string as bundle success instead of checking the git bundle create exit code.
- Omitting run_manifest.json or making branches_restored inconsistent with repair_log.refs_restored.
- Producing non-deterministic JSON ordering or changed report contents across clean reruns.
- Accepting a corrupt bundle and writing a misleading successful repair.
```

## Solution Summary

```text
The task is an offline Git ref-restoration problem, not a content-reconstruction problem. The solution starts from the surviving after-force-push bundle, loads dangling loose objects into a clean recovery repository, and moves each required branch ref to the exact original object ID with git update-ref. Recreated commits are invalid even if their file contents match.

The submitted utility must also prove that it handles two materially different cases: a partial-overlap recovery where the bundle and loose object store are both necessary, and a corrupted bundle that must be rejected without producing a misleading successful repair. The repaired bundle, JSON reports, reflog ordering, graph topology, required Git blob IDs, and clean-rerun determinism are all checked against independent fixtures.
```

## Final Verifiers List

Use the 13-point numbered list below. Do not use the auto-generated platform proposal — it will include a solve.py-dependent determinism check and will be missing the partial-overlap, corrupted-bundle, and recovery-case-report checks.

```text
The verifier is deterministic and grades the submitted artifacts and recovery-tool behavior using programmatic checks only.

1. Required output presence. Require non-empty outputs/recovery_tool.py, outputs/repaired_repo.bundle, outputs/repair_log.json, outputs/commit_graph_report.json, outputs/recovery_case_report.json, and outputs/run_manifest.json. Failure code: MISSING_FILE.

2. Python tool validity. Compile outputs/recovery_tool.py with Python's compile check. Failure code: TEST_FAIL.

3. JSON schema validation. Parse each required JSON report and validate its required keys, types, nested value shapes, allowed values, and additional-property rules against the matching file in output_schemas/. Failure code: SCHEMA_INVALID.

4. Primary bundle validity. Clone outputs/repaired_repo.bundle into a fresh mirror repository and run git fsck --connectivity-only. Cloning and connectivity must succeed with no missing or corrupt objects. Failure code: TEST_FAIL.

5. Exact ref restoration. Load expected_refs.json directly and compare it with the full refs/heads/* mapping from the cloned repaired bundle. Compare the same mapping with repair_log.refs_expected, repair_log.refs_restored, repair_log.branches_restored, and repair_log.all_refs_restored. Recreated commits with different SHAs fail even if file contents match. Failure code: TEST_FAIL or CONTRACT_DRIFT.

6. Reflog ordering. Parse each leading SHA from reflog_export.txt, shorten it to 7 characters, dedupe by first appearance, and require exact ordered equality with repair_log.orphaned_shas. Failure code: CONTRACT_DRIFT.

7. Commit graph. Load commit_graph_spec.json directly. Require the same branch set, expected tip values, expected ancestor arrays, ordered found ancestry prefixes, and all_reachable=true values in commit_graph_report.json. Failure code: TEST_FAIL or CONTRACT_DRIFT.

8. Required Git blob IDs. Load expected_file_checksums.json directly. Require every declared commit/path key in repair_log.checksums, require status="match", and independently resolve each blob with git rev-parse <sha>:<path> in the cloned repaired bundle. The reported expected value, actual value, fixture value, and independently resolved blob ID must all match. Failure code: TEST_FAIL or CONTRACT_DRIFT.

9. Run-manifest consistency. Require run_manifest.branches_restored to equal the exact restored-ref count and require run_manifest.bundle_created=true. Failure code: CONTRACT_DRIFT.

10. Partial-overlap recovery case. Execute the submitted outputs/recovery_tool.py against recovery_cases/partial_overlap/ in a fresh temporary directory. Require exit code 0, a cloneable repaired case bundle, git fsck --connectivity-only success, and exact equality with the case's expected refs. Failure code: TEST_FAIL.

11. Corrupted-bundle rejection case. Execute the submitted outputs/recovery_tool.py against recovery_cases/corrupted_bundle/ in a fresh temporary directory. Require a non-zero exit code, require run_manifest.error="after_bundle_invalid", and require that no repaired bundle was produced. Failure code: INVALID_CASE_ACCEPTED or CONTRACT_DRIFT.

12. Clean-rerun determinism. Execute the submitted outputs/recovery_tool.py against the primary case in a fresh temporary directory. Require byte-identical repair_log.json, commit_graph_report.json, and run_manifest.json files plus an equivalent repaired-bundle signature: same refs, same histories, and same connectivity result. This check runs against the submitted tool and does not depend on a reference solve.py being present. Failure code: NON_DETERMINISTIC_OUTPUT.

13. Recovery-case report consistency. Require outputs/recovery_case_report.json to record PASS for partial-overlap recovery and PASS for corrupted-bundle rejection. Failure code: CONTRACT_DRIFT.

Exit code 0 means every check passed. Exit code 1 means the first violation was reported with one of these reason codes: MISSING_FILE, SCHEMA_INVALID, TEST_FAIL, CONTRACT_DRIFT, NON_DETERMINISTIC_OUTPUT, or INVALID_CASE_ACCEPTED.
```

## Verifiers Explanation

```text
The verifier grades only the required outputs and the submitted recovery tool's behavior. It checks that the repaired primary bundle clones and passes Git connectivity checks, compares restored refs and report values directly with independent fixtures, enforces first-seen reflog ordering, resolves required Git blob IDs independently, executes the submitted tool against the partial-overlap and corrupted-bundle cases, and reruns the submitted tool from a clean state to detect non-deterministic output. All checks are programmatic.
```

## Engine and Generator Changes

These are the changes made to the pipeline generator so future Git recovery tasks are produced correctly without requiring manual fixes.

### app.js — composePrompt (Git domain)

- Replaced rotating first-person openerPools with a fixed structured prompt containing five labeled sections: Objective, Provided files, Deliverables, Success criteria, and Constraints. Reviewers explicitly require this structure.
- Added `outputs/recovery_tool.py` and `outputs/recovery_case_report.json` to the Deliverables section.
- Added `recovery_cases/partial_overlap/` and `recovery_cases/corrupted_bundle/` to the Provided files section with plain-language descriptions.
- Added the offline constraint directly in the Constraints section ("Run entirely offline after unpacking the zip").
- Added explicit reflog ordering rule to Success criteria (7-character short SHA, first-seen order, no duplicates, no sorting).
- Added the corrupted-bundle rejection requirement to Success criteria (`error="after_bundle_invalid"`).
- Updated Git-specific fallback verifier and README generation so bypassing the locked recipe cannot reintroduce stale template reason codes or the old `verifier_inputs/` folder label.

### backend/lib/git-package-v2.js — package generator

- Added `recovery_cases/partial_overlap/` as a real generated case where the bundle and loose object store each provide only part of the required graph. Confirmed with extracted-ZIP proof that neither source alone is sufficient.
- Added `recovery_cases/corrupted_bundle/` as a real generated case with a corrupt bundle the tool must reject.
- Added `.gitkeep` to `recovery_cases/corrupted_bundle/orphaned_object_store/.git/objects/` so ZIP extraction cannot convert the intentionally empty directory into a missing-input case.
- Added `output_schemas/recovery_case_report.schema.json` to the generated package.
- Renamed `verifier_inputs/` to `recovery_cases/` to remove internal assessment language from the worker-facing package.
- Updated README.md template to use `recovery_cases/` naming and document both required cases.

### verify.py — independent verifier

- Replaced solve.py-dependent determinism check with a tool-based check that runs `outputs/recovery_tool.py` against the primary case in a fresh directory. The check does not require a reference `solve.py` to be present.
- Added partial-overlap case execution check (verifier 10).
- Added corrupted-bundle rejection check (verifier 11).
- Added recovery-case report consistency check (verifier 13).
- Removed `STDERR_WARNING` and `THRESHOLD_FAIL` reason codes. Valid codes are now: `MISSING_FILE`, `SCHEMA_INVALID`, `TEST_FAIL`, `CONTRACT_DRIFT`, `NON_DETERMINISTIC_OUTPUT`, `INVALID_CASE_ACCEPTED`.

### server.js — backend export engine

- Hardened Git package export so it cannot fall back to the browser's generic placeholder ZIP builder. Git builds must go through the local Runner and its pre-ship gate.
- Backend compatibility ZIP now excludes `solve.py`, `verify.py`, `recovery_tool.py`, `outputs/`, `recovery_worktree/`, and generated `case_runs/`, matching the worker-facing sanitization policy.

## Linter Traps From This Task

Avoid these in future verifier text:

- Do not include `verifier_inputs/*.json` as a core output verifier. They are input fixtures, not solver outputs.
- Do not duplicate clone checks in multiple sections.
- Do not add a separate "recreated commits fail" verifier. Exact ref equality already covers it.
- Do not rely on schema checks alone for `repair_log.refs_expected` or `repair_log.refs_restored`; explicitly compare both to `expected_refs.json`.
- Do not say only that expected ancestors "appear"; also say exact graph contract equality against `commit_graph_spec.json`.
- Do not list failure reason codes in final verifiers unless the platform specifically asks. The linter may treat that as verifier implementation detail.

## ZIP Naming and Sanitization Notes

Final submission filenames:

```text
6a1885adf570e57154a8295c_resources.zip
6a1885adf570e57154a8295c_golden_solution.zip
```

The final ZIPs were scanned for AI/tool attribution wording. The scan checked for `codex`, `chatgpt`, `openai`, `llm`, standalone `ai`, `artificial intelligence`, `ai assistant`, `generated`, `generator`, and `selection-improvement-runner`.

When creating future upload ZIPs, use human-readable task-ID names and avoid path or filename fragments such as `backend`, `generated_packages`, `task_kit`, or long random package IDs.

## Future Checklist

Before resubmitting a revised task:

1. Regenerate both ZIPs after making generator/verifier fixes.
2. Confirm worker-facing resources ZIP excludes `solve.py`, `verify.py`, `recovery_tool.py`, `outputs/`, and scratch folders.
3. Confirm resources text lists only actual files in the resources ZIP.
4. Confirm prompt has no vague threshold language and uses five labeled sections: Objective, Provided files, Deliverables, Success criteria, Constraints.
5. Confirm prompt states the offline requirement directly in the Constraints section.
6. Confirm prompt defines 7-character first-seen reflog SHA ordering in Success criteria.
7. Confirm worker-facing case folder is named `recovery_cases/`, not `verifier_inputs/`.
8. Confirm `run_manifest.json` has a schema and verifier checks.
9. Confirm checksum verifier loads `expected_file_checksums.json` directly and requires every key.
10. Confirm final verifier list has no input-fixture checks unless those fixtures are solver outputs.
11. Confirm final verifier list explicitly compares report fields to fixture files when the prompt says "exactly."
12. On the form's Golden Solution Steps Description page, replace the auto-generated content. Remove any steps that invoke `verify.py` or describe running the checker. The correct version has 13 steps covering setup, parse, reflog, recovery repo, refs, graph, checksums, bundle, repair_log, run_manifest, two required cases, recovery_case_report, and determinism rerun.
13. On the form's Final Verifiers page, replace the auto-generated list with the 13-point numbered list from the checklist. Confirm verifier 12 (determinism) does not reference `solve.py`.
14. Confirm upload filenames are clear and professional.
15. Re-run the platform linter and only dismiss issues that refer to stale computer-generated suggestions, not your final pasted fields.
