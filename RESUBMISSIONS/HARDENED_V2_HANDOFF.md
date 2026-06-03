# Hardened V2 Handoff

Upload these fresh files:

`selection_improvement_experts_RESOURCES_task_kit_v2.zip`
`selection_improvement_experts_GOLDEN_SOLUTION_FILES_golden_kit_v2.zip`

Copies were also placed in:

`C:\Users\enter\OneDrive\Desktop\RESUBMISSIONS`

## What changed

Removed direct answer fixtures from the worker-facing resource kit:
 : `expected_refs.json`
 : `commit_graph_spec.json`
 : `expected_file_checksums.json`
Added `recovery_plan.json` to the primary case and both recovery cases.
Moved exact expected refs, graph specs, and blob IDs into hidden golden-side `verifier_inputs/`.
Updated `verify.py` to grade against hidden verifier inputs instead of worker-visible files.
Updated `recovery_tool.py` so the reference solution derives refs and checksums from reflog evidence and `recovery_plan.json`.

## Local verification

Fresh combined v2 run passed:

```text
VERIFY PASS: All checks ok
```

## Dylan / queue status

On 2026-06-03, Dylan_QM said the task could be sent back to the queue and the
difficulty node can be rerun after a hardened v2 submission.

Use the v2 upload files only. The earlier May 31 zips are still useful history,
but they expose direct answer fixtures and should not be used for the rerun.

## Why this should raise difficulty

The old kit handed the model exact refs, expected graph chains, and required blob IDs. The hardened kit forces the solver to inspect Git objects and derive the exact outputs from evidence rules, while the verifier still checks exact hidden answers.

## Compass repo status

The Compass Ultra app source was not changed for this benchmark fix. The work
for this pass is limited to the benchmark hardening files under `hardening-v2/`
and the copied v2 upload zips in `C:\Users\enter\OneDrive\Desktop\RESUBMISSIONS`.

