# Selection Improvement Experts Git Resubmission: Hardened V2

Use this v2 package after Dylan_QM returned the task to the queue for a
difficulty rerun.

## Upload mapping

Resources: `selection_improvement_experts_RESOURCES_task_kit_v2.zip`
Golden Solution Files: `selection_improvement_experts_GOLDEN_SOLUTION_FILES_golden_kit_v2.zip`

Both files were copied to:

`C:\Users\enter\OneDrive\Desktop\RESUBMISSIONS`

## Fresh local pre-ship result

```text
VERIFY PASS: All checks ok
```

## What changed from the May 31 package

The worker-facing resources no longer include direct answer files:
 : `expected_refs.json`
 : `commit_graph_spec.json`
 : `expected_file_checksums.json`
The exact answer fixtures moved to golden-side `verifier_inputs/`.
The resources now include `recovery_plan.json`, which gives evidence rules
  instead of exact answers.
`verify.py` now grades against hidden verifier inputs.
`recovery_tool.py` now derives refs and checksum targets from reflog evidence
  and `recovery_plan.json`.

## Difficulty rationale

The previous difficulty node likely passed 3/3 because the model could read the
exact target refs, graph chains, and blob IDs directly from the resource zip.
The hardened v2 still has a deterministic verifier, but it forces the solver to
derive the final answers from Git objects and reflog evidence.

## Do not upload

`selection_improvement_experts_RESOURCES_task_kit.zip`
`selection_improvement_experts_GOLDEN_SOLUTION_FILES_golden_kit.zip`
`hardening-v2/test-run/`
`hardening-work/`
`hardening-work-golden/`

