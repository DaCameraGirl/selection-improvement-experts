# Outlier Git Recovery Resubmission: V2 Notes

Use the original accepted form text as the base, but update the resource and
verifier wording to reflect the hardened v2 package.

## Prompt Field Replacement

```text
## Objective

Restore the published Git refs after an accidental force push changed branch history. Preserve the exact original commit SHAs; do not recreate equivalent commits with cherry-pick.

## Provided files

`repo_after_force.bundle`, `orphaned_object_store/.git/objects`, `reflog_export.txt`, and `recovery_plan.json` describe the primary recovery evidence.
`recovery_plan.json` identifies branch tips and checksum targets by reflog subject. Derive the exact refs, graph, and Git blob IDs from the Git evidence; direct answer fixtures are not provided in the worker resources.
`recovery_cases/partial_overlap/` contains a second valid recovery where the after-bundle and loose object store each provide only part of the required graph.
`recovery_cases/corrupted_bundle/` contains an invalid bundle that your tool must reject as `after_bundle_invalid` without emitting a misleading successful repair.
`output_schemas/` defines the JSON output contracts. `README.md` explains the case layouts.

## Deliverables

Create `outputs/recovery_tool.py`, `outputs/repaired_repo.bundle`, `outputs/repair_log.json`, `outputs/commit_graph_report.json`, `outputs/recovery_case_report.json`, and `outputs/run_manifest.json`.

## Success criteria

The repaired primary bundle must clone successfully and pass `git fsck --connectivity-only` with no missing or corrupt objects.
Restore every required branch ref to the exact original SHA derived from the evidence, report the recovered graph, and report every requested checksum target with `status="match"`.
`repair_log.orphaned_shas` must include each leading SHA from `reflog_export.txt` exactly once, in first-seen reflog order, using 7-character short SHA form.
`outputs/recovery_tool.py` must restore the partial-overlap case and reject the corrupted-bundle case with `error="after_bundle_invalid"`. Record both outcomes in `outputs/recovery_case_report.json`.

## Constraints

Run entirely offline after unpacking the zip. All JSON outputs must match the schemas in `output_schemas/`, preserve declared ordering, and be deterministic across clean reruns.
```

## Resources Field Update

```text
Upload one self-contained resources zip named selection_improvement_experts_RESOURCES_task_kit_v2.zip. It contains the worker-facing task inputs only and does not contain solve.py, verify.py, recovery_tool.py, precomputed outputs, verifier_inputs, direct answer fixtures, or scratch worktrees.

Files included in the resources zip:
README.md
version_manifest.json
repo_after_force.bundle
orphaned_object_store/.git/HEAD
orphaned_object_store/.git/objects/
reflog_export.txt
recovery_plan.json
output_schemas/repair_log.schema.json
output_schemas/commit_graph_report.schema.json
output_schemas/recovery_case_report.schema.json
output_schemas/run_manifest.schema.json
recovery_cases/partial_overlap/
recovery_cases/corrupted_bundle/
```

## Verifier Field Update

```text
The verifier is deterministic and grades the submitted artifacts and recovery-tool behavior using programmatic checks only. Exact expected refs, graph topology, and required Git blob IDs are loaded from hidden golden-side verifier_inputs, not from worker-visible resource files.
```

## Upload Files

`selection_improvement_experts_RESOURCES_task_kit_v2.zip`
`selection_improvement_experts_GOLDEN_SOLUTION_FILES_golden_kit_v2.zip`

