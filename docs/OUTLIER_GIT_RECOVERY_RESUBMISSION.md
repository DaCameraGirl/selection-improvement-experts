# Outlier Git Recovery Resubmission

Use this document when resubmitting the Git force-push recovery task. Do not
reuse text copied from the May 16, May 22, or May 28 submissions.

The generator and independent verifier implement the contract described below.
The only remaining platform-only action is running the GPTZero linter before
clicking Submit.

## Prompt Field

```text
## Objective

Restore the published Git refs after an accidental force push changed branch history. Preserve the exact original commit SHAs; do not recreate equivalent commits with cherry-pick.

## Provided files

- `repo_after_force.bundle`, `orphaned_object_store/.git/objects`, `reflog_export.txt`, `expected_refs.json`, `commit_graph_spec.json`, and `expected_file_checksums.json` describe the primary recovery.
- `recovery_cases/partial_overlap/` contains a second valid recovery where the after-bundle and loose object store each provide only part of the required graph.
- `recovery_cases/corrupted_bundle/` contains an invalid bundle that your tool must reject as `after_bundle_invalid` without emitting a misleading successful repair.
- `output_schemas/` defines the JSON output contracts. `README.md` explains the case layouts.

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

## Golden Solution Field

```text
This is an offline Git object-recovery task. The key insight is that the required commit objects must retain their original identities. Recreating equivalent commits with cherry-pick is incorrect because it changes the commit SHAs. The implementation should be a reusable recovery utility, not a one-off repair for the primary fixture.

1. Create `outputs/recovery_tool.py` as a command-line utility that accepts a case root, output directory, and clean worktree path. A case root contains an after-force-push bundle, a loose object store, reflog evidence, expected refs, an expected graph specification, and required Git blob IDs.

2. For one recovery run, clear the requested worktree and case output directory. Validate that the required input files and `orphaned_object_store/.git/objects` exist before attempting recovery. If required evidence is missing, exit non-zero and write a failed run manifest without producing a repaired bundle.

3. Clone the supplied `repo_after_force.bundle` into the clean worktree. Treat clone failure as an invalid bundle: exit non-zero, record the failure in the run manifest, and do not emit a successful repaired bundle.

4. Copy the supplied loose objects into the cloned repository's `.git/objects` directory. Run `git fsck --lost-found` to surface unreachable objects, but do not use generated lost-found files as the source of truth.

5. Parse `reflog_export.txt` line by line. For every line with a leading SHA token, record its 7-character short form once, preserving first-seen order. Do not sort the list.

6. Load `expected_refs.json`. For each expected ref, use `git cat-file -e` to confirm the target object exists, then restore that exact object ID with `git update-ref`. Remove unrelated branch refs before exporting the repaired bundle so the result matches the declared ref contract exactly.

7. Load `commit_graph_spec.json`. For each expected branch tip, use `git rev-list` and compare the ordered 7-character ancestor chain with the declared ancestry. Record the expected and found chains plus an `all_reachable` boolean in `commit_graph_report.json`.

8. Load `expected_file_checksums.json`. For each required commit and path, resolve the Git blob ID with `git rev-parse <sha>:<path>`. Record `status`, `expected`, and `actual` for every required entry. A passing repair reports `status="match"` for every required blob ID.

9. Run `git fsck --connectivity-only` in the repaired worktree and create the repaired bundle with `git bundle create --all`. Write deterministic `repair_log.json`, `commit_graph_report.json`, and `run_manifest.json` reports that follow the schemas in `output_schemas/`.

10. Use the same recovery utility for the required cases. For `recovery_cases/partial_overlap/`, combine the after-bundle and loose object store and produce a cloneable, connected repaired bundle with the exact expected refs. For `recovery_cases/corrupted_bundle/`, reject the invalid bundle with `error="after_bundle_invalid"` and a non-zero exit code. Do not produce a successful repaired bundle.

11. Write `outputs/recovery_case_report.json` with the partial-overlap recovery result and corrupted-bundle rejection result. Both case outcomes must be reported as `PASS`.

12. Re-run the primary recovery from a clean state. Confirm that the JSON reports are byte-identical and that the rebuilt bundle has equivalent refs, histories, and connectivity results.

Common failure modes:

- Cherry-picking or recreating commits, which changes the required SHAs.
- Assuming the after-bundle or loose object store is complete by itself in the partial-overlap case.
- Accepting a corrupt bundle and emitting a misleading successful bundle.
- Sorting or duplicating reflog SHA entries instead of preserving first-seen order.
- Reporting only checksum entries that happen to pass instead of reporting every required fixture key.
- Creating the repaired bundle without `--all`, which omits required refs.
```

## Final Verifiers Field

```text
The verifier is deterministic and grades the submitted artifacts and recovery-tool behavior. It does not use an LLM judge.

1. Required output presence. Require non-empty `outputs/recovery_tool.py`, `outputs/repaired_repo.bundle`, `outputs/repair_log.json`, `outputs/commit_graph_report.json`, `outputs/recovery_case_report.json`, and `outputs/run_manifest.json`. Failure code: `MISSING_FILE`.

2. Python tool validity. Compile `outputs/recovery_tool.py` with Python's compile check. Failure code: `TEST_FAIL`.

3. JSON schema validation. Parse each required JSON report and validate its required keys, types, nested value shapes, allowed values, and additional-property rules against the matching file in `output_schemas/`. Failure code: `SCHEMA_INVALID`.

4. Primary bundle validity. Clone `outputs/repaired_repo.bundle` into a fresh mirror repository and run `git fsck --connectivity-only`. Cloning and connectivity must succeed with no missing or corrupt objects. Failure code: `TEST_FAIL`.

5. Exact ref restoration. Load `expected_refs.json` directly and compare it with the full `refs/heads/*` mapping from the cloned repaired bundle. Compare the same mapping with `repair_log.refs_expected`, `repair_log.refs_restored`, `repair_log.branches_restored`, and `repair_log.all_refs_restored`. Recreated commits with different SHAs fail even if file contents match. Failure code: `TEST_FAIL` or `CONTRACT_DRIFT`.

6. Reflog ordering. Parse each leading SHA from `reflog_export.txt`, shorten it to 7 characters, dedupe by first appearance, and require exact ordered equality with `repair_log.orphaned_shas`. Failure code: `CONTRACT_DRIFT`.

7. Commit graph. Load `commit_graph_spec.json` directly. Require the same branch set, expected tip values, expected ancestor arrays, ordered found ancestry prefixes, and `all_reachable=true` values in `commit_graph_report.json`. Failure code: `TEST_FAIL` or `CONTRACT_DRIFT`.

8. Required Git blob IDs. Load `expected_file_checksums.json` directly. Require every declared commit/path key in `repair_log.checksums`, require `status="match"`, and independently resolve each blob with `git rev-parse <sha>:<path>` in the cloned repaired bundle. The reported expected value, actual value, fixture value, and independently resolved blob ID must all match. Failure code: `TEST_FAIL` or `CONTRACT_DRIFT`.

9. Run-manifest consistency. Require `run_manifest.branches_restored` to equal the exact restored-ref count and require `run_manifest.bundle_created=true`. Failure code: `CONTRACT_DRIFT`.

10. Partial-overlap recovery case. Execute the submitted `outputs/recovery_tool.py` against `recovery_cases/partial_overlap/` in a fresh temporary directory. Require exit code 0, a cloneable repaired case bundle, `git fsck --connectivity-only` success, and exact equality with the case's expected refs. Failure code: `TEST_FAIL`.

11. Corrupted-bundle rejection case. Execute the submitted `outputs/recovery_tool.py` against `recovery_cases/corrupted_bundle/` in a fresh temporary directory. Require a non-zero exit code, require `run_manifest.error="after_bundle_invalid"`, and require that no repaired bundle was produced. Failure code: `INVALID_CASE_ACCEPTED` or `CONTRACT_DRIFT`.

12. Clean-rerun determinism. Execute the submitted `outputs/recovery_tool.py` against the primary case in a fresh temporary directory. Require byte-identical `repair_log.json`, `commit_graph_report.json`, and `run_manifest.json` files plus an equivalent repaired-bundle signature: same refs, same histories, and same connectivity result. This check runs against the submitted tool and does not depend on a reference `solve.py` being present. Failure code: `NON_DETERMINISTIC_OUTPUT`.

13. Recovery-case report consistency. Require `outputs/recovery_case_report.json` to record `PASS` for partial-overlap recovery and `PASS` for corrupted-bundle rejection. Failure code: `CONTRACT_DRIFT`.

Exit code 0 means every check passed. Exit code 1 means the first violation was reported with one of these reason codes: `MISSING_FILE`, `SCHEMA_INVALID`, `TEST_FAIL`, `CONTRACT_DRIFT`, `NON_DETERMINISTIC_OUTPUT`, or `INVALID_CASE_ACCEPTED`.
```

## ZIP Uploads

Generate a fresh Git package through the local backend immediately before
submitting. Upload:

- `*_task_kit.zip` to the Outlier **Resources** upload field.
- `*_golden_kit.zip` to the Outlier **Golden Solution Files** upload field.

Do not upload an old May ZIP. Do not upload the combined local runner archive.

The Resources ZIP must not contain:

- `solve.py`
- `verify.py`
- `recovery_tool.py`
- precomputed `outputs/`
- scratch `recovery_worktree/`
- generated `case_runs/`
- worker-facing `verifier_inputs/`

## Manual Platform Check

Run the platform GPTZero linter after pasting the final text and before
submitting. The local repository cannot execute the platform's GPTZero service.
