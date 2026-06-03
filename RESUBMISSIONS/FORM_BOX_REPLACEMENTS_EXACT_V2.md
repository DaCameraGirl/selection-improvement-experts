# Exact V2 Form Box Replacements

Use this for the actual Outlier/Terminal Bench form. Do not paste the old text that says worker resources include `expected_refs.json`, `commit_graph_spec.json`, or `expected_file_checksums.json`.

## Is this task viable?

Keep:

```text
Yes: Task is viable
```

## Please name the specific field, including sub-field, which describes the category of the task.

Keep:

```text
Software Engineering, Version Control
```

## Title or name

Keep:

```text
Git force-push recovery: restore refs with exact original topology
```

## Prompt (previously "instruction")

Replace the whole box with:

```text
I need help restoring the published Git refs after my team made an accidental force push that changed branch history. Preserve the exact original commit SHAs; do not recreate equivalent commits with cherry-pick.

Provided files

`repo_after_force.bundle`, `orphaned_object_store/.git/objects`, `reflog_export.txt`, and `recovery_plan.json` describe the primary recovery evidence.
`recovery_plan.json` identifies branch tips and checksum targets by reflog subject. Derive the exact refs, graph, and Git blob IDs from the Git evidence; direct answer fixtures are not provided in the worker resources.
`recovery_cases/partial_overlap/` contains a second valid recovery where the after-bundle and loose object store each provide only part of the required graph.
`recovery_cases/corrupted_bundle/` contains an invalid bundle that your tool must reject as `after_bundle_invalid` without emitting a misleading successful repair.
`output_schemas/` defines the JSON output contracts. `README.md` explains the case layouts.

Deliverables

Create `outputs/recovery_tool.py`, `outputs/repaired_repo.bundle`, `outputs/repair_log.json`, `outputs/commit_graph_report.json`, `outputs/recovery_case_report.json`, and `outputs/run_manifest.json`.

Success criteria

The repaired primary bundle must clone successfully and pass `git fsck --connectivity-only` with no missing or corrupt objects.
Restore every required branch ref to the exact original SHA derived from the evidence, report the recovered graph, and report every requested checksum target with `status="match"`.
`repair_log.orphaned_shas` must include each leading SHA from `reflog_export.txt` exactly once, in first-seen reflog order, using 7-character short SHA form.
`outputs/recovery_tool.py` must restore the partial-overlap case and reject the corrupted-bundle case with `error="after_bundle_invalid"`. Record both outcomes in `outputs/recovery_case_report.json`.

Constraints

Run entirely offline after unpacking the zip. All JSON outputs must match the schemas in `output_schemas/`, preserve declared ordering, and be deterministic across clean reruns.
```

## Short summary or "proposal"

Replace with:

```text
Recover a force-pushed Git graph by combining the surviving after-bundle with dangling loose objects, deriving exact branch refs and checksum targets from reflog evidence, restoring original commit SHAs without cherry-pick, and handling both partial-overlap recovery and corrupted-bundle rejection. Produce a verified repaired bundle and deterministic machine-readable recovery reports.
```

## Explain why this task is difficult and what expertise it requires

Replace with:

```text
This is a hard senior-level version-control recovery task because it requires practical Git internals knowledge beyond routine branch commands. In real work, senior software engineers, release engineers, and DevOps/SRE staff need to solve this when an accidental force push rewrites published history and disrupts an audit trail, release branch, hotfix branch, or deployment source of truth.

The data is a synthetic but realistic force-push recovery fixture: a surviving Git bundle, dangling loose objects from another clone, reflog-style evidence, output schemas, and separate recovery cases. The solver must preserve exact commit identities, derive branch refs and checksum targets from evidence instead of direct answer fixtures, combine a surviving bundle with dangling loose objects, restore refs without recreating commits, recover a partial-overlap case where neither evidence source is sufficient alone, reject a corrupted bundle without emitting a misleading successful repair, and produce deterministic JSON reports validated against independent hidden verifier inputs. Common approaches such as cherry-picking can produce plausible file contents while failing the required SHA contract.
```

## List and provide the resources required to complete this task

Replace the whole box with:

```text
Resources:

Public source references:
Git reflog documentation: https://git-scm.com/docs/git-reflog
Git bundle documentation: https://git-scm.com/docs/git-bundle
Real force-push recovery scenarios: https://ohshitgit.com/

Upload one self-contained resources zip named selection_improvement_experts_RESOURCES_task_kit_v2.zip. It contains the worker-facing task inputs only and does not contain solve.py, verify.py, recovery_tool.py, precomputed outputs, verifier_inputs, direct answer fixtures, or scratch worktrees.

Files included in the resources zip:
README.md: describes each fixture, required output path, and offline workflow requirement.
version_manifest.json: runtime and package manifest with Python, Node, Git, variant, and OS assumptions.
repo_after_force.bundle: Git bundle reflecting the surviving remote state after the force push.
orphaned_object_store/.git/HEAD: minimal Git metadata for the dangling object store.
orphaned_object_store/.git/objects/: dangling loose Git objects containing lost commits and related trees and blobs.
reflog_export.txt: reflog-style evidence; the first token on each line is a commit SHA to preserve.
recovery_plan.json: worker-facing recovery rules identifying branch tips and checksum targets by reflog subject.
output_schemas/repair_log.schema.json: JSON Schema for outputs/repair_log.json.
output_schemas/commit_graph_report.schema.json: JSON Schema for outputs/commit_graph_report.json.
output_schemas/recovery_case_report.schema.json: JSON Schema for outputs/recovery_case_report.json.
output_schemas/run_manifest.schema.json: JSON Schema for outputs/run_manifest.json.
recovery_cases/partial_overlap/: valid recovery case where the after-bundle and loose object store each provide only part of the required graph.
recovery_cases/corrupted_bundle/: invalid bundle case that the submitted tool must reject as after_bundle_invalid.

Required deliverables from the solver:
outputs/recovery_tool.py
outputs/repaired_repo.bundle
outputs/repair_log.json
outputs/commit_graph_report.json
outputs/recovery_case_report.json
outputs/run_manifest.json

The workflow must run without network access after the zip is unpacked. The repository bundle, dangling object store, reflog export, recovery plan, schemas, and recovery cases are synthetically constructed for this force-push recovery scenario and have no licensing restrictions. Exact expected refs, graph topology, and required Git blob IDs are not in the worker resources; they are checked by hidden golden-side verifier inputs.
```

## Provide any files required to complete this task

Upload this file:

```text
selection_improvement_experts_RESOURCES_task_kit_v2.zip
```

## Please write the full golden solution

Replace with:

```text
This is an offline Git object-recovery task. The key insight is that the required commit objects must retain their original identities. Recreating equivalent commits with cherry-pick is incorrect because it changes the commit SHAs. The implementation should be a reusable recovery utility, not a one-off repair for the primary fixture.

1. Create `outputs/recovery_tool.py` as a command-line utility that accepts a case root, output directory, and clean worktree path. A case root contains an after-force-push bundle, a loose object store, reflog evidence, a recovery plan, output schemas, and recovery cases.

2. For one recovery run, clear the requested worktree and case output directory. Validate that the required input files and `orphaned_object_store/.git/objects` exist before attempting recovery. If required evidence is missing, exit non-zero and write a failed run manifest without producing a repaired bundle.

3. Validate the supplied `repo_after_force.bundle` with Git. Treat clone or bundle-header failure as an invalid bundle: exit non-zero, record `error="after_bundle_invalid"` in the run manifest for that case, and do not emit a successful repaired bundle.

4. Clone or unbundle the supplied `repo_after_force.bundle` into a clean recovery repository. Copy the supplied loose objects from `orphaned_object_store/.git/objects` into the recovery repository's `.git/objects` directory. Run `git fsck --lost-found` to surface unreachable objects, but do not use generated lost-found files as the source of truth.

5. Parse `reflog_export.txt` line by line. For every line with a leading SHA token, record its 7-character short form once, preserving first-seen order. Do not sort the list.

6. Load `recovery_plan.json`. For each branch target, find the reflog entry whose subject contains the requested text, resolve that short SHA to the exact full commit object ID in the combined repository, confirm it exists with `git cat-file -e`, and restore that exact object ID with `git update-ref`.

7. Build `commit_graph_report.json` from the recovered Git graph. For each restored branch, use `git rev-list <tip>` to report the ordered 7-character ancestry chain in the schema fields. The hidden verifier checks the exact expected graph topology, so the report must be deterministic and must not invent or omit commits.

8. For each checksum target in `recovery_plan.json`, resolve the matching commit from reflog evidence and run `git rev-parse <sha>:<path>` to get the Git blob ID. Record `status`, `expected`, and `actual` for every requested target. A passing repair reports `status="match"` for every required blob ID.

9. Run `git fsck --connectivity-only` in the repaired worktree and create the repaired bundle with all restored refs included. Write deterministic `repair_log.json`, `commit_graph_report.json`, and `run_manifest.json` reports that follow the schemas in `output_schemas/`.

10. Use the same recovery utility for the required cases. For `recovery_cases/partial_overlap/`, combine the after-bundle and loose object store and produce a cloneable, connected repaired bundle with the exact expected refs. For `recovery_cases/corrupted_bundle/`, reject the invalid bundle with `error="after_bundle_invalid"` and a non-zero exit code. Do not produce a successful repaired bundle.

11. Write `outputs/recovery_case_report.json` with the partial-overlap recovery result and corrupted-bundle rejection result. Both case outcomes must be reported as `PASS`.

12. Re-run the primary recovery from a clean state. Confirm that the JSON reports are byte-identical and that the rebuilt bundle has equivalent refs, histories, and connectivity results.

Common failure modes:

Cherry-picking or recreating commits, which changes the required SHAs.
Assuming the after-bundle or loose object store is complete by itself in the partial-overlap case.
Accepting a corrupt bundle and emitting a misleading successful bundle.
Sorting or duplicating reflog SHA entries instead of preserving first-seen order.
Reporting only checksum entries that happen to pass instead of reporting every requested checksum target.
Creating the repaired bundle without all required refs.
Treating a non-empty bundle path string as bundle success instead of checking the git bundle create exit code.
Omitting run_manifest.json or making branches_restored inconsistent with repair_log.refs_restored.
Producing non-deterministic JSON ordering or changed report contents across clean reruns.
```

## Golden Solution Files

Upload this file:

```text
selection_improvement_experts_GOLDEN_SOLUTION_FILES_golden_kit_v2.zip
```

## Time estimate

Keep:

```text
It would take approximately 3-5 hours for a senior software engineer, release engineer, or DevOps/SRE practitioner with hands-on Git internals experience.
```

## Propose and describe a set of verifiers

Replace with:

```text
The verifier is deterministic and grades the submitted artifacts and recovery-tool behavior using programmatic checks only. Exact expected refs, graph topology, and required Git blob IDs are loaded from hidden golden-side verifier_inputs, not from worker-visible resource files.

1. Required output presence. Require non-empty `outputs/recovery_tool.py`, `outputs/repaired_repo.bundle`, `outputs/repair_log.json`, `outputs/commit_graph_report.json`, `outputs/recovery_case_report.json`, and `outputs/run_manifest.json`. Failure code: `MISSING_FILE`.

2. Python tool validity. Compile `outputs/recovery_tool.py` with Python's compile check. Failure code: `TEST_FAIL`.

3. JSON schema validation. Parse each required JSON report and validate its required keys, types, nested value shapes, allowed values, and additional-property rules against the matching file in `output_schemas/`. Failure code: `SCHEMA_INVALID`.

4. Primary bundle validity. Clone `outputs/repaired_repo.bundle` into a fresh mirror repository and run `git fsck --connectivity-only`. Cloning and connectivity must succeed with no missing or corrupt objects. Failure code: `TEST_FAIL`.

5. Exact ref restoration. Load expected refs from hidden golden-side `verifier_inputs` and compare them with the full `refs/heads/*` mapping from the cloned repaired bundle. Compare the same mapping with `repair_log.refs_expected`, `repair_log.refs_restored`, `repair_log.branches_restored`, and `repair_log.all_refs_restored`. Recreated commits with different SHAs fail even if file contents match. Failure code: `TEST_FAIL` or `CONTRACT_DRIFT`.

6. Reflog ordering. Parse each leading SHA from `reflog_export.txt`, shorten it to 7 characters, dedupe by first appearance, and require exact ordered equality with `repair_log.orphaned_shas`. Failure code: `CONTRACT_DRIFT`.

7. Commit graph. Load expected graph topology from hidden golden-side `verifier_inputs`. Require the same branch set, expected tip values, expected ancestor arrays, ordered found ancestry prefixes, and `all_reachable=true` values in `commit_graph_report.json`. Failure code: `TEST_FAIL` or `CONTRACT_DRIFT`.

8. Required Git blob IDs. Load required Git blob IDs from hidden golden-side `verifier_inputs`. Require every declared commit/path key in `repair_log.checksums`, require `status="match"`, and independently resolve each blob with `git rev-parse <sha>:<path>` in the cloned repaired bundle. The reported expected value, actual value, hidden fixture value, and independently resolved blob ID must all match. Failure code: `TEST_FAIL` or `CONTRACT_DRIFT`.

9. Run-manifest consistency. Require `run_manifest.branches_restored` to equal the exact restored-ref count and require `run_manifest.bundle_created=true`. Failure code: `CONTRACT_DRIFT`.

10. Partial-overlap recovery case. Execute the submitted `outputs/recovery_tool.py` against `recovery_cases/partial_overlap/` in a fresh temporary directory. Require exit code 0, a cloneable repaired case bundle, `git fsck --connectivity-only` success, and exact equality with the case's expected refs from hidden golden-side `verifier_inputs`. Failure code: `TEST_FAIL`.

11. Corrupted-bundle rejection case. Execute the submitted `outputs/recovery_tool.py` against `recovery_cases/corrupted_bundle/` in a fresh temporary directory. Require a non-zero exit code, require `run_manifest.error="after_bundle_invalid"`, and require that no repaired bundle was produced. Failure code: `INVALID_CASE_ACCEPTED` or `CONTRACT_DRIFT`.

12. Clean-rerun determinism. Execute the submitted `outputs/recovery_tool.py` against the primary case in a fresh temporary directory. Require byte-identical `repair_log.json`, `commit_graph_report.json`, and `run_manifest.json` files plus an equivalent repaired-bundle signature: same refs, same histories, and same connectivity result. This check runs against the submitted tool and does not depend on a reference `solve.py` being present. Failure code: `NON_DETERMINISTIC_OUTPUT`.

13. Recovery-case report consistency. Require `outputs/recovery_case_report.json` to record `PASS` for partial-overlap recovery and `PASS` for corrupted-bundle rejection. Failure code: `CONTRACT_DRIFT`.

Exit code 0 means every check passed. Exit code 1 means the first violation was reported with one of these reason codes: `MISSING_FILE`, `SCHEMA_INVALID`, `TEST_FAIL`, `CONTRACT_DRIFT`, `NON_DETERMINISTIC_OUTPUT`, or `INVALID_CASE_ACCEPTED`.
```

## Golden Solution Steps Description

Replace with:

```text
This describes how to restore Git branch refs after a force push, using only the files in the resources zip. No network access is needed after unpacking. The audience is a coder with basic Git familiarity who will translate this into terminal commands.

The key insight: this is a ref-restore problem, not a re-commit problem. The solution must preserve original commit object IDs. Recreated commits with different SHAs are not acceptable, even if the file contents look correct. Start from `repo_after_force.bundle`, load the dangling loose objects from `orphaned_object_store/.git/objects`, derive branch tips and checksum targets from `recovery_plan.json` and `reflog_export.txt`, restore each required ref with `git update-ref`, and prove the recovery with `git fsck`, `git rev-list`, and `git rev-parse`.

1. Set up the environment

Create `outputs/` if it does not exist. This is where every result lands.

Create `outputs/recovery_tool.py` as a reusable command-line utility. It must accept a case root directory, an output directory, and a clean worktree path. All recovery logic, including the primary case and the two required cases, runs through this same tool.

Use standard Python modules such as `os`, `sys`, `json`, `re`, `subprocess`, `shutil`, `stat`, `platform`, and `pathlib.Path`.

2. Parse input files

Read every worker-visible input file the task ships:

`repo_after_force.bundle`: Git bundle reflecting the surviving remote state after the force push.
`orphaned_object_store/.git/objects`: dangling loose Git objects containing the lost commits and related trees/blobs.
`reflog_export.txt`: reflog-style text. The first whitespace token on each line is a commit SHA.
`recovery_plan.json`: recovery rules that identify branch tips and checksum targets by reflog subject.
`output_schemas/`: JSON schemas for the required reports.
`recovery_cases/partial_overlap/`: a valid recovery case where neither the bundle nor the loose object store is sufficient alone.
`recovery_cases/corrupted_bundle/`: an invalid bundle case the tool must reject.

3. Process reflog entries

Walk `reflog_export.txt` line by line and pull out the leading SHA. Keep entries in file order, dedupe by first appearance, and do not sort. `repair_log.orphaned_shas` must use 7-character short SHAs in this same order.

4. Prepare the recovery repository

Delete any old recovery worktree safely. Clone or unbundle `repo_after_force.bundle` into the clean recovery repository. If the bundle is invalid or cannot be read, exit non-zero, write a failed `run_manifest.json` with `error="after_bundle_invalid"`, and do not write a repaired bundle.

Copy every directory and file from `orphaned_object_store/.git/objects` into the recovery repository's `.git/objects`. Run `git fsck --lost-found` after copying so Git can surface unreachable objects, but do not use lost-found output as the source of truth.

5. Restore Git refs to exact derived SHAs

Load `recovery_plan.json`. For every branch target, find the reflog entry whose subject contains the configured text. Resolve that short SHA to the full 40-character commit ID in the combined repository. Confirm the target commit exists with `git cat-file -e <sha>`. If it exists, run `git update-ref <ref> <sha>`. Record successful updates in `refs_restored`.

6. Verify commit reachability

For each restored branch, walk back from the recovered tip with `git rev-list <tip>`. Convert found commits to 7-character short SHAs.

Write `outputs/commit_graph_report.json` with branches, tip, expected_ancestors, found_ancestors, and all_reachable. The report must be deterministic and must reflect the recovered Git graph exactly; the hidden verifier checks the exact expected topology.

7. Verify file checksums

For every checksum target in `recovery_plan.json`, resolve the matching commit from reflog evidence and run `git rev-parse <sha>:<path>`. Compare the returned Git blob ID to the same path in the repaired repository. Record status, expected, and actual for every requested target.

8. Create the repaired bundle

Run `git fsck --connectivity-only` in the repaired worktree. Create `outputs/repaired_repo.bundle` with all restored refs included. Record bundle_created from the command exit code.

9. Generate repair_log.json

Write `outputs/repair_log.json` with exactly these top-level keys: branches_restored, refs_expected, refs_restored, all_refs_restored, orphaned_shas, bundle_created, and checksums.

refs_expected and refs_restored must contain the exact restored ref-to-SHA mapping. all_refs_restored is true only when every required ref was restored. checksums must include every requested checksum target from `recovery_plan.json`.

10. Generate run_manifest.json

Write `outputs/run_manifest.json` with solver, python, branches_restored, and bundle_created. branches_restored must equal the number of refs in refs_restored.

11. Handle the two required recovery cases

Run `outputs/recovery_tool.py` against `recovery_cases/partial_overlap/` in a fresh temporary directory. It must exit 0 and produce a cloneable repaired bundle that passes `git fsck --connectivity-only` with exact expected refs. Neither the bundle nor the loose object store alone is sufficient; both are required for this case to succeed.

Run `outputs/recovery_tool.py` against `recovery_cases/corrupted_bundle/` in a fresh temporary directory. It must exit non-zero and write `run_manifest.error="after_bundle_invalid"`. No repaired bundle should be produced.

12. Write outputs/recovery_case_report.json

Record the result of each case run. The partial-overlap recovery outcome must be PASS. The corrupted-bundle rejection outcome must be PASS. This file must follow `output_schemas/recovery_case_report.schema.json`.

13. Confirm deterministic reruns

Re-run `outputs/recovery_tool.py` against the primary case in a fresh temporary directory. `repair_log.json`, `commit_graph_report.json`, and `run_manifest.json` must be byte-identical to the first run. The rebuilt bundle must have the same refs, histories, and connectivity result.

Common failure modes to avoid:

Recreating commits with new SHAs instead of restoring refs to existing object IDs.
Using only `repo_after_force.bundle` and never loading `orphaned_object_store/.git/objects`.
Assuming either source alone is sufficient for the partial-overlap case.
Writing the repaired bundle without all required refs.
Comparing file SHA-256 hashes instead of Git blob IDs.
Reporting only checksum keys that pass instead of every requested checksum target.
Treating a non-empty bundle path string as bundle success instead of checking the git bundle create exit code.
Omitting run_manifest.json or making branches_restored inconsistent with repair_log.refs_restored.
Producing non-deterministic JSON ordering or changed report contents across clean reruns.
Accepting a corrupt bundle and writing a misleading successful repair.
```

## Solution Summary

Replace with:

```text
The task is an offline Git ref-restoration problem, not a content-reconstruction problem. The solution starts from the surviving after-force-push bundle, loads dangling loose objects into a clean recovery repository, derives required branch tips and checksum targets from reflog evidence and recovery_plan.json, and moves each required branch ref to the exact original object ID with git update-ref. Recreated commits are invalid even if their file contents match.

The submitted utility must also prove that it handles two materially different cases: a partial-overlap recovery where the bundle and loose object store are both necessary, and a corrupted bundle that must be rejected without producing a misleading successful repair. The repaired bundle, JSON reports, reflog ordering, graph topology, required Git blob IDs, and clean-rerun determinism are all checked against hidden golden-side verifier inputs.
```

## Final Verifiers list

Use the same text as "Propose and describe a set of verifiers" above.

## Verifiers Explanation

Replace with:

```text
The verifier grades only the required outputs and the submitted recovery tool's behavior. It checks that the repaired primary bundle clones and passes Git connectivity checks, compares restored refs and report values against hidden golden-side verifier_inputs, enforces first-seen reflog ordering, resolves required Git blob IDs independently, executes the submitted tool against the partial-overlap and corrupted-bundle cases, and reruns the submitted tool from a clean state to detect non-deterministic output. All checks are programmatic.
```

## Do you agree with the evaluation?

Keep:

```text
agree
```

## Explanation

Replace with:

```text
I agree with the evaluation. The task is verifiable, outcome-based, solvable, and requires code execution. The hardened v2 resources remove direct answer fixtures from the worker-facing zip, add recovery_plan.json as evidence, and move exact refs, graph topology, and blob IDs into hidden golden-side verifier_inputs. The verifier checks schema compliance, clone and fsck behavior, exact hidden fixture equality, reflog ordering, recovery-case behavior, and clean-rerun determinism.
```



