# Git Force-Push Recovery Revision History

This note records the reviewer feedback for the Selection Improvement Experts Git
force-push recovery task and the corresponding generator changes. It is kept in
the repository so future submissions do not regress to an earlier contract.

## May 16, 2026: Remove Answer Leakage

Reviewer findings:

- `solve.py` and `verify.py` were included in the worker-facing ZIP.
- The resources description also listed those answer-bearing files.
- The prompt incorrectly referred to outputs that "produce new SHAs."
- The task still had an unresolved GPTZero linter flag.

Applied fixes:

- Split generated archives into a worker task kit and a reference golden kit.
- Exclude reference scripts and precomputed outputs from the worker task kit.
- Keep reference scripts only in the golden attachment.
- Remove the misleading new-SHA wording and tighten generated prose.

## May 22, 2026: Harden the Deterministic Contract

Reviewer findings:

- The prompt did not fully define JSON schemas, ordering rules, or exact-match
  behavior.
- The written verifier description promised checks that `verify.py` did not
  perform.
- Checksum verification accepted omitted fixture keys because it only examined
  keys reported by the solution.
- The run manifest, reflog ordering, and clean-rerun determinism contracts were
  not enforced.

Applied fixes:

- Add schemas for every JSON report.
- Verify required checksum keys by loading `expected_file_checksums.json`
  directly.
- Enforce exact refs, reflog first-seen ordering, graph reachability, manifest
  consistency, bundle cloneability, `git fsck --connectivity-only`, and clean
  reruns.
- Add a pre-ship gate that runs the generated reference solution and verifier.

## May 28, 2026: Make Edge Cases Real

Reviewer findings:

- Recovery remained too mechanical after the solver recognized the exact-SHA
  requirement.
- Extra edge and corrupted fixtures were listed but not exercised as required
  behavior.
- Worker-facing `verifier_inputs/` naming exposed internal assessment language.
- Offline behavior and reflog ordering needed to be stated directly.
- The golden write-up contained reference code, repeated schema details, and
  instructions to run the checker.
- Generic reason codes included checks that did not exist for this task.
- Determinism depended on a reference `solve.py` being present.

Applied fixes:

- Require `outputs/recovery_tool.py`, a reusable offline recovery utility.
- Add neutral `recovery_cases/partial_overlap/` and
  `recovery_cases/corrupted_bundle/` directories.
- Generate a real partial-overlap case where the bundle and loose object store
  are both necessary.
- Generate a corrupted-bundle case that the submitted tool must reject.
- Add `outputs/recovery_case_report.json`.
- Run determinism checks against the submitted recovery tool, independent of
  the hidden reference wrapper.
- Use only Git-task reason codes that map to real checks:
  `MISSING_FILE`, `SCHEMA_INVALID`, `TEST_FAIL`, `CONTRACT_DRIFT`,
  `NON_DETERMINISTIC_OUTPUT`, and `INVALID_CASE_ACCEPTED`.
- Generate a structured worker prompt with objective, provided files,
  deliverables, success criteria, and constraints.
- Keep the generated golden write-up focused on ordered prose steps.

## Current Verification Evidence

The revised generator was exercised through the real local backend build
endpoint on May 31, 2026. The pre-ship gate generated a fresh synthetic Git
package, ran the hidden reference wrapper, and ran the independent verifier.

Observed result:

```text
VERIFY PASS: All checks ok
```

The generated package audit reported:

```text
unused_fixture_count: 0
difficulty: hard
implementationLines: 168
```

The worker-facing ZIP was inspected directly. It contains input fixtures,
`output_schemas/`, `recovery_cases/`, `README.md`, and
`version_manifest.json`. It does not contain:

- `solve.py`
- `verify.py`
- `recovery_tool.py`
- precomputed `outputs/`
- `recovery_worktree/`
- generated `case_runs/`

The golden attachment contains the hidden reference scripts and computed
outputs. These remain isolated from the worker resource ZIP.

## Future Submission Checklist

Before uploading another Git recovery task:

1. Generate a fresh package through the local backend instead of reusing an old
   ZIP.
2. Confirm the backend response reports `gate.passed: true`.
3. Confirm the backend response reports `unused_fixture_count: 0`.
4. Inspect the worker ZIP manifest and verify no reference script or precomputed
   output leaked into it.
5. Inspect the prompt for structured sections: objective, provided files,
   deliverables, success criteria, and constraints.
6. Confirm the prompt states the offline requirement directly.
7. Confirm the prompt defines 7-character first-seen reflog SHA ordering.
8. Confirm the worker-facing case folder is named `recovery_cases/`, not
   `verifier_inputs/`.
9. Confirm the golden write-up is prose-only and does not paste the reference
   implementation or instruct the solver to run an internal checker.
10. Run the platform linter, including GPTZero, before submission. The local
    repository cannot execute the platform's GPTZero service, so this remains a
    manual upload-time check.
