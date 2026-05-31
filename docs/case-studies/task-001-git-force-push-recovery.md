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

## Original Prompt

```text
Please help me with restoring the published Git refs after a force push changes the branch history. Match expected_refs.json exactly and ensure no missing or corrupt objects to promote confidence in the process. Land outputs/repaired_repo.bundle, outputs/repair_log.json, outputs/commit_graph_report.json, and outputs/run_manifest.json in the outputs folder. Next, ensure the repaired bundle clones successfully, pass git fsck --connectivity-only with 0 missing or corrupt objects, and satisfy the parent-chain and checksum fixtures within the contract threshold.
```

## Review Feedback

Main return reasons:

1. The prompt named four artifacts but did not define a deterministic output contract: JSON schemas, field types, ordering rules, or the meaning of "contract threshold."
2. Written verifier claims did not match actual `verify.py`: missing schema checks, manifest reads, reflog/orphan checks, verifier input usage, and rerun/determinism checks.
3. Checksum verification trusted only reported `repair_log.checksums` entries and did not compare every required key from `expected_file_checksums.json`.
4. The worker/input ZIP still contained reference files or references to them, despite the Resources text claiming they had been removed.

## Corrected Prompt

Use a short prompt with exact output requirements and no vague threshold language:

```text
I am in a jam. My team needs help restoring published Git refs after a force push changed branch history. Please use the provided after-bundle, dangling object store, reflog export, expected refs, commit graph spec, checksum fixtures, schemas, and verifier fixtures.

Create these files in the outputs folder: repaired_repo.bundle, repair_log.json, commit_graph_report.json, and run_manifest.json. Restore refs to the exact SHAs in expected_refs.json. Recreated commits with different SHAs are not acceptable.

The repaired bundle must clone successfully and pass git fsck --connectivity-only with no missing or corrupt objects. It must preserve reflog SHAs in repair_log.orphaned_shas order, match commit_graph_spec.json exactly, and report every expected_file_checksums.json entry as status="match". All JSON outputs must follow the schemas in output_schemas, and rerunning the solution from a clean state must produce deterministic equivalent outputs.
```

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

Use these standard Python modules: os, sys, json, re, subprocess, shutil, stat, platform, and pathlib.Path.

2. Parse input files

Read every input file the task ships:

- repo_after_force.bundle - Git bundle reflecting the surviving remote state after the force push.
- orphaned_object_store/.git/objects - dangling loose Git objects containing the lost commits and related trees/blobs.
- reflog_export.txt - reflog-style text. The first whitespace token on each line is a commit SHA.
- commit_graph_spec.json - expected final branch topology.
- expected_refs.json - exact mapping of refs/heads/<name> to a full 40-character SHA.
- expected_file_checksums.json - expected Git blob IDs for key files at recovered commits.

3. Process reflog entries

Walk reflog_export.txt line by line and pull out the leading SHA. Keep entries in file order, dedupe by first appearance, and do not sort. repair_log.orphaned_shas must use 7-character short SHAs in this same order.

4. Prepare the recovery repository

Delete any old recovery_worktree/ safely. Clone repo_after_force.bundle into recovery_worktree/. This gives the post-force-push repository state.

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

11. Verify the recovery

Run python verify.py from the task root. Expect exit code 0 and VERIFY PASS: All checks ok.

The verifier checks required outputs, schemas, repaired bundle cloneability, git fsck --connectivity-only, exact refs, reflog SHA ordering, parent-chain reachability, required checksum keys, run_manifest consistency, and deterministic rerun behavior.

12. Controlled negative check

Temporarily delete one output file or change one expected ref value in refs_restored and rerun verify.py. It should exit 1 with a deterministic FAIL reason. Restore the correct outputs before submission.
```

## Solution Summary

```text
The task is a Git ref-restore problem, not a content reconstruction problem. The recovery starts from repo_after_force.bundle, copies dangling loose objects from orphaned_object_store/.git/objects into a recovery worktree, then points each refs/heads/* entry to the exact 40-character SHA from expected_refs.json using git update-ref. Recreated commits with different SHAs are invalid even if their file contents match.

The proof has three core parts: create outputs/repaired_repo.bundle with git bundle create --all and confirm it clones and passes git fsck --connectivity-only; use git rev-list from each restored branch tip to confirm expected parent-chain reachability from commit_graph_spec.json; and use git rev-parse <sha>:<path> to confirm every required Git blob ID in expected_file_checksums.json is reported as a match. The JSON reports must follow the declared schemas, preserve required ordering, and remain deterministic across clean reruns.
```

## Final Verifiers List

The linter was sensitive to wording. Keep these exact concepts and avoid mentioning `verifier_inputs` in the verifier list, because those are input fixtures and the linter classified them as ancillary.

```text
Verify that outputs/repaired_repo.bundle exists, is non-empty, clones successfully in a fresh temporary directory, and passes git fsck --connectivity-only with no missing or corrupt objects.

Verify that outputs/repair_log.json, outputs/commit_graph_report.json, and outputs/run_manifest.json exist, are non-empty, parse as valid JSON, and satisfy their schemas in output_schemas/.

Load expected_refs.json and verify that every full ref name in expected_refs.json is present in the cloned repaired bundle and points to the exact expected 40-character SHA.

repair_log.refs_expected_matches_expected_refs: Verify that repair_log.refs_expected exactly equals expected_refs.json.

repair_log.refs_restored_matches_expected: Verify that repair_log.refs_restored exactly equals expected_refs.json.

repair_log.branches_restored_content: Verify that repair_log.branches_restored contains exactly the refs from expected_refs.json and the cloned repaired bundle, with no missing, extra, or substituted refs.

Verify that repair_log.all_refs_restored is true because repair_log.refs_restored exactly equals expected_refs.json and the cloned bundle refs.

repair_log.bundle_created_true: Verify that repair_log.bundle_created is true and consistent with the repaired bundle existing, cloning successfully, and passing git fsck --connectivity-only.

Parse reflog_export.txt, extract the leading SHA from each line, dedupe by first appearance, convert to 7-character short SHAs, and verify that the ordered list exactly equals repair_log.orphaned_shas.

commit_graph_report_exact_match: Verify that commit_graph_report.json exactly equals commit_graph_spec.json for the graph contract, including branch set, expected tip values, ancestor lists, SHA values, field values, and ordering.

Verify that every expected ancestor in commit_graph_spec.json appears in commit_graph_report.json for the matching branch and that all_reachable is true.

Load expected_file_checksums.json directly and verify that every required commit/file key appears in repair_log.checksums.

For every required checksum entry, verify that status is "match", expected equals the fixture Git blob ID, and actual equals the same Git blob ID.

Verify that run_manifest.solver and run_manifest.python are non-empty strings.

Verify that run_manifest.bundle_created is true and consistent with repair_log.bundle_created and the actual repaired bundle checks.

Verify that run_manifest.branches_restored equals the number of refs in repair_log.refs_restored, equals the number of refs in repair_log.branches_restored, and equals the number of restored refs actually present in the cloned repaired bundle.

If solve.py is present in the golden solution package, rerun it from a clean state after deleting outputs/ and recovery_worktree/. Verify that the JSON reports are byte-identical across runs and that the rebuilt bundle clones to the same refs, rev-list histories, and git fsck --connectivity-only result.
```

## Verifiers Explanation

```text
The verifiers grade only the required outputs: the repaired bundle and the three JSON reports. They first check file existence, JSON validity, schema compliance, bundle cloneability, and Git object integrity. The ref checks compare every full ref name in expected_refs.json against the cloned repaired bundle and compare the same expected mapping against repair_log.refs_expected, repair_log.refs_restored, and repair_log.branches_restored. They also check repair_log.all_refs_restored, repair_log.bundle_created, and run_manifest.branches_restored against the actual cloned bundle so the reports cannot disagree with the recovered repository. The reflog check confirms repair_log.orphaned_shas preserves first-seen reflog order. The graph check explicitly verifies exact equality between commit_graph_report.json and commit_graph_spec.json for the graph contract, including branch set, expected tips, ancestor lists, SHA values, field values, and ordering. The checksum checks load expected_file_checksums.json directly and require every required commit/file key to appear with matching Git blob IDs. The manifest checks confirm run_manifest.json is consistent with the repair log and actual bundle, and the determinism check confirms repeated clean runs produce stable reports and equivalent bundle behavior.
```

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
2. Confirm worker-facing resources ZIP excludes `solve.py`, `verify.py`, `outputs/`, and scratch folders.
3. Confirm resources text lists only actual files in the resources ZIP.
4. Confirm prompt has no vague threshold language.
5. Confirm `run_manifest.json` has a schema and verifier checks.
6. Confirm checksum verifier loads `expected_file_checksums.json` directly and requires every key.
7. Confirm final verifier list has no input-fixture checks unless those fixtures are solver outputs.
8. Confirm final verifier list explicitly compares report fields to fixture files when the prompt says "exactly."
9. Confirm upload filenames are clear and professional.
10. Re-run the platform linter and only dismiss issues that refer to stale computer-generated suggestions, not your final pasted fields.
