# Selection Improvement Experts - 5pm Finish Plan

Current local app:

`C:\Users\enter\Desktop\Improvement Experts\index.html`

Current GitHub repo:

`https://github.com/DaCameraGirl/selection-improvement-experts`

Current good app version should show:

`2026-05-08 airtight-core`

If the app still says `source-isolation`, hard refresh with `Ctrl + F5` or close/reopen the HTML file.

## What The Tool Does

The app is a worker-side submission builder for Selection Improvement Expert style tasks.

It helps produce:

- Project fit
- Expertise target
- Agent prompt
- Resources needed
- Golden solution
- Difficulty explanation
- Professional time estimate
- Verifiers description
- Optional agent difficulty check
- Internal review rubrics/checklists

The package output now separates:

- `SUBMIT-READY CONTENT`
- `INTERNAL REVIEW AIDS`

Only paste internal review aids if the platform has a matching field or asks for them.

## Strongest Candidate

Use the Biomedical Signal Processing / PhysioNet task first.

Why:

- It uses a real public source: PhysioNet MIT-BIH Arrhythmia Database v1.0.0.
- It can name specific records: 100, 101, 103.
- It has clear signal-processing methods.
- It has deterministic reference annotations.
- It naturally supports normal, edge, and invalid fixtures.
- It is easy to make verifiable with CSV/JSON outputs.

## Strongest Computer Science Track

If the submitted task should match your background, use one of these before biomedical:

Your background to lean on:

- Master's in computer science
- Master's in AI ethics
- Minor in robotics
- Software development background

1. Software engineering API regression benchmark

- Best fit for real CS/software work.
- Use a pinned open-source repository snapshot.
- Include `repo_snapshot/`, failing tests, API contract, regression fixtures, lockfile, and expected behavior.
- Strong outputs: `outputs/fix.patch`, `outputs/test_report.json`, `outputs/compatibility_summary.json`, `outputs/minimal_repro.md`.
- Verifier applies the patch to a clean snapshot and runs exact tests.

2. Computer science algorithms adversarial benchmark

- Best fit for theory plus implementation.
- Use a self-contained problem statement with fixed constraints and generated cases.
- Include `problem_statement.md`, `constraints.json`, `seed_generator.py`, `adversarial_cases.jsonl`, `reference_outputs.jsonl`, and `runtime_budget.json`.
- Strong outputs: `outputs/solution.py`, `outputs/test_results.json`, `outputs/divergence_report.json`, `outputs/complexity_note.md`.
- Verifier checks correctness and runtime/asymptotic behavior on adversarial cases.

3. Databases/query optimization regression

- Best fit for systems/database experience.
- Include `schema.sql`, sample data, workload SQL, before/after explain plans, table statistics, and PostgreSQL version.
- Strong outputs: `outputs/query_plan_diagnosis.md`, `outputs/rewrite.sql`, `outputs/benchmark_metrics.csv`, `outputs/root_cause.json`.
- Verifier checks same result rows, plan-node evidence, repeated benchmark medians, and index/workload constraints.

4. Distributed systems consistency replay

- Strong but more advanced.
- Include JSONL histories, partition windows, node configs, invariant spec, and expected counterexamples.
- Strong outputs: `outputs/consistency_violations.json`, `outputs/replay_summary.json`, `outputs/minimal_counterexample.json`.
- Verifier replays the reported minimal counterexample.

5. Compilers/static analysis semantic preservation

- Strong but must be carefully scoped.
- Include source fixtures, expected stdout/exit codes, IR before/after, pass config, grammar/type rules, and expected semantic failures.
- Strong outputs: `outputs/ir_diff_report.json`, `outputs/semantic_test_results.json`, `outputs/unsafe_transformations.csv`.
- Verifier must check executable behavior, not only IR text.

For your background, the safest CS submission is probably **Software engineering API regression benchmark** or **Algorithms adversarial benchmark**.

6. AI ethics and model governance audit

- Best fit for the AI ethics master's plus CS background.
- Use de-identified decision logs, labels, model card, dataset card, threshold policy, protected-attribute handling policy, and slice definitions.
- Strong outputs: `outputs/governance_metrics.json`, `outputs/fairness_audit.csv`, `outputs/policy_exceptions.csv`, `outputs/rejected_records.csv`.
- Verifier checks label leakage, protected-attribute policy compliance, slice-level fairness/calibration metrics, and traceable exception reason codes.

Given your credentials, the best final choices are:

1. **AI ethics and model governance audit** if the project accepts governance/fairness style tasks.
2. **Software engineering API regression benchmark** if you want the safest pure CS/software task.
3. **Robotics trajectory controller audit** if you want to use the robotics minor.
4. **ML systems batch-vs-online drift audit** if you want CS plus AI systems.

## Essential Before Submitting

Every named resource must exist or be directly sourced.

Required resource package structure should include:

- `README.md`
- `environment/requirements.txt` or `environment/environment.yml`
- `environment/version_manifest.json`
- `data/raw/mitdb_100_signal.csv`
- `data/raw/mitdb_101_signal.csv`
- `data/raw/mitdb_103_signal.csv`
- `data/reference/beat_annotations.csv`
- `config/filter_change.yaml`
- `schemas/beat_report.schema.json`
- `verifier_inputs/normal_record_100.csv`
- `verifier_inputs/edge_noisy_segment_101.csv`
- `verifier_inputs/invalid_sampling_rate_103.csv`
- `verifier_inputs/expected_metrics.json`

Expected output paths:

- `outputs/beat_validation_report.csv`
- `outputs/validation_metrics.json`
- `outputs/plots/record_overlay.png`
- `outputs/run_manifest.json`
- `outputs/qc_summary.json`

## What Airtight Means

A task is not airtight unless:

- The public source is exact.
- All input files are named.
- Output files are named.
- Output schemas are stated.
- Tolerances are stated.
- Normal case, edge case, and invalid case are included.
- The golden solution proves the answer is solvable.
- The verifier checks output files, not reasoning.
- No LLM-as-judge.
- No vague phrases such as `where relevant`, `realistic files`, `domain-appropriate`, or `supporting evidence` without specifics.

## Tomorrow Workflow

1. Open the app.
2. Confirm the version says `2026-05-08 airtight-core`.
3. Click `Clear Draft`.
4. Select:
   - Expertise: `Master's level` or `Senior professional`
   - Domain: `Biomedical signal processing`
   - Task shape: `Verifier-focused benchmark` or `Data analysis artifact`
   - Work standard: `Enterprise production` or `Regulated / audited`
5. Generate draft.
6. Keep only submit-ready blocks unless platform asks for rubrics.
7. Replace any generated generic wording with exact source/file/tolerance details.
8. Build the actual resource zip or at least define it precisely.
9. Run through the checklist.
10. Submit by 5pm.

## Watchouts

- Do not submit the internal checklist.
- Do not submit a resource file name unless that file exists in the zip or is clearly sourced.
- Avoid using a PhD target unless the task truly has research-level depth.
- ML systems and robotics are good, but require more real source work.
- Biomedical/PhysioNet is currently safest.

## Recent Commits

- `db7e8eb` Update airtight core version marker
- `d6ece96` Tighten core criteria evidence
- `c51a2ef` Show prompt maker version
- `340c7fb` Isolate generated source notes
