const STORAGE_KEY = "selection-improvement-experts-v1";

const state = {
  guides: [],
  activeView: "library",
  query: ""
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  search: document.querySelector("#search"),
  guideForm: document.querySelector("#guide-form"),
  guideId: document.querySelector("#guide-id"),
  guideTitle: document.querySelector("#guide-title"),
  guideTags: document.querySelector("#guide-tags"),
  guideBody: document.querySelector("#guide-body"),
  resetForm: document.querySelector("#reset-form"),
  guideList: document.querySelector("#guide-list"),
  matchCount: document.querySelector("#match-count"),
  statGuides: document.querySelector("#stat-guides"),
  statRules: document.querySelector("#stat-rules"),
  questionInput: document.querySelector("#question-input"),
  analyzeQuestion: document.querySelector("#analyze-question"),
  relevantResults: document.querySelector("#relevant-results"),
  answerOutline: document.querySelector("#answer-outline"),
  taskDomain: document.querySelector("#task-domain"),
  taskExpertise: document.querySelector("#task-expertise"),
  taskDomainSelect: document.querySelector("#task-domain-select"),
  taskType: document.querySelector("#task-type"),
  taskStandard: document.querySelector("#task-standard"),
  taskPrompt: document.querySelector("#task-prompt"),
  taskResources: document.querySelector("#task-resources"),
  taskSolution: document.querySelector("#task-solution"),
  taskDifficulty: document.querySelector("#task-difficulty"),
  taskTime: document.querySelector("#task-time"),
  taskVerifiers: document.querySelector("#task-verifiers"),
  taskAgentCheck: document.querySelector("#task-agent-check"),
  taskChecks: document.querySelector("#task-checks"),
  generatedTaskPackage: document.querySelector("#generated-task-package"),
  fillStarterTemplate: document.querySelector("#fill-starter-template"),
  buildTaskPackage: document.querySelector("#build-task-package"),
  copyTaskPackage: document.querySelector("#copy-task-package"),
  exportData: document.querySelector("#export-data"),
  importData: document.querySelector("#import-data"),
  clearData: document.querySelector("#clear-data"),
  sampleData: document.querySelector("#sample-data"),
  template: document.querySelector("#guide-card-template")
};

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "you", "your", "are", "was", "were",
    "have", "has", "not", "but", "can", "will", "should", "into", "when", "what", "which",
    "they", "their", "there", "about", "then", "than", "must", "may", "all", "any"
  ]);

  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length > 18);
}

function extractRules(body) {
  const lines = String(body || "").replace(/\r/g, "").split("\n");
  const ruleSignals = /\b(always|never|required|must|should|do not|don't|avoid|only|unless|reject|accept|rate|score|pass|fail|example|if|when)\b/i;
  const bulletOrNumber = /^\s*([-*•]|\d+[.)])\s+/;

  const extracted = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 14 && (bulletOrNumber.test(line) || ruleSignals.test(line)))
    .map((line) => line.replace(bulletOrNumber, "").trim());

  if (extracted.length) return [...new Set(extracted)].slice(0, 30);
  return splitSentences(body).slice(0, 16);
}

function getAllRules() {
  return state.guides.flatMap((guide) =>
    extractRules(guide.body).map((rule) => ({
      guideId: guide.id,
      title: guide.title,
      tags: guide.tags,
      rule
    }))
  );
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    guides: state.guides
  }));
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.guides = Array.isArray(saved.guides) ? saved.guides : [];
  } catch {
    state.guides = [];
  }
}

function setView(view) {
  state.activeView = view;
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  els.views.forEach((panel) => panel.classList.toggle("is-visible", panel.id === `view-${view}`));
}

function scoreText(haystack, needle) {
  const hay = normalize(haystack);
  const terms = tokenize(needle);
  if (!terms.length) return 0;

  return terms.reduce((score, term) => {
    if (hay.includes(term)) return score + 1;
    return score;
  }, 0) / terms.length;
}

function searchGuides(query) {
  if (!query.trim()) return state.guides;
  return state.guides
    .map((guide) => ({
      guide,
      score: scoreText(`${guide.title} ${guide.tags} ${guide.body}`, query)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.guide);
}

function renderStats() {
  els.statGuides.textContent = state.guides.length;
  els.statRules.textContent = getAllRules().length;
}

function renderGuideList() {
  const guides = searchGuides(state.query);
  els.guideList.innerHTML = "";
  els.matchCount.textContent = `${guides.length} ${guides.length === 1 ? "match" : "matches"}`;

  if (!guides.length) {
    els.guideList.className = "guide-list empty";
    els.guideList.textContent = state.guides.length ? "No guidelines match that search." : "Paste onboarding guidelines to build your library.";
    renderStats();
    return;
  }

  els.guideList.className = "guide-list";
  guides.forEach((guide) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const rules = extractRules(guide.body);
    node.querySelector("h3").textContent = guide.title;
    node.querySelector(".tags").textContent = guide.tags || "No tags";
    node.querySelector(".excerpt").textContent = guide.body.slice(0, 220) + (guide.body.length > 220 ? "..." : "");
    node.querySelector(".edit-guide").addEventListener("click", () => editGuide(guide.id));
    node.querySelector(".delete-guide").addEventListener("click", () => deleteGuide(guide.id));

    const ruleList = node.querySelector(".rule-list");
    rules.slice(0, 10).forEach((rule) => {
      const item = document.createElement("li");
      item.textContent = rule;
      ruleList.appendChild(item);
    });

    els.guideList.appendChild(node);
  });

  renderStats();
}

function resetForm() {
  els.guideId.value = "";
  els.guideTitle.value = "";
  els.guideTags.value = "";
  els.guideBody.value = "";
  els.guideTitle.focus();
}

function editGuide(id) {
  const guide = state.guides.find((item) => item.id === id);
  if (!guide) return;
  els.guideId.value = guide.id;
  els.guideTitle.value = guide.title;
  els.guideTags.value = guide.tags;
  els.guideBody.value = guide.body;
  setView("library");
  els.guideTitle.focus();
}

function deleteGuide(id) {
  const guide = state.guides.find((item) => item.id === id);
  if (!guide) return;
  const confirmed = confirm(`Delete "${guide.title}"?`);
  if (!confirmed) return;
  state.guides = state.guides.filter((item) => item.id !== id);
  save();
  renderGuideList();
}

function saveGuide(event) {
  event.preventDefault();
  const title = els.guideTitle.value.trim();
  const tags = els.guideTags.value.trim();
  const body = els.guideBody.value.trim();
  const id = els.guideId.value || uid();
  if (!title || !body) return;

  const existingIndex = state.guides.findIndex((guide) => guide.id === id);
  const guide = { id, title, tags, body, updatedAt: new Date().toISOString() };

  if (existingIndex >= 0) state.guides[existingIndex] = guide;
  else state.guides.unshift(guide);

  save();
  resetForm();
  renderGuideList();
}

function highlight(text, terms) {
  let output = text;
  terms.slice(0, 8).forEach((term) => {
    if (!term) return;
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`(${safe})`, "ig"), "<mark>$1</mark>");
  });
  return output;
}

function analyzeQuestion() {
  const question = els.questionInput.value.trim();
  if (!question) {
    els.questionInput.focus();
    return;
  }

  const terms = tokenize(question);
  const matches = getAllRules()
    .map((rule) => ({
      ...rule,
      score: scoreText(`${rule.title} ${rule.tags} ${rule.rule}`, question)
    }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  els.relevantResults.innerHTML = "";
  els.relevantResults.className = matches.length ? "result-list" : "result-list empty";

  if (!matches.length) {
    els.relevantResults.textContent = "No matching guideline snippets found. Add more guidelines or include more detail in the question.";
    els.answerOutline.className = "outline-box empty";
    els.answerOutline.textContent = "The outline will appear here.";
    return;
  }

  matches.forEach((match) => {
    const card = document.createElement("article");
    card.className = "result-card";
    card.innerHTML = `<h3>${escapeHtml(match.title)}</h3><p>${highlight(escapeHtml(match.rule), terms)}</p>`;
    els.relevantResults.appendChild(card);
  });

  els.answerOutline.className = "outline-box";
  els.answerOutline.innerHTML = `
    <ol>
      <li>State the decision using the exact category, rating, or action requested by the question.</li>
      <li>Cite the highest-match rule: ${escapeHtml(matches[0].rule)}</li>
      <li>Compare the scenario details against the rule, including any exception or rejection condition.</li>
      <li>Close with the final answer and one short reason grounded in the guideline text.</li>
    </ol>
  `;
}

function buildTaskPackage() {
  const fields = getTaskFields();
  renderTaskChecks(fields);

  if (taskContentValues(fields).every((value) => !value)) {
    els.generatedTaskPackage.value = "Use Generate Draft or enter your own task details, then click Build Package.";
    return;
  }

  els.generatedTaskPackage.value = [
    "Selection Improvement Expert Worker Submission Package",
    "==============================================",
    "",
    "COPY BLOCK 1 - Project Fit",
    "----------------------------------------------",
    packageText(fields.domain, "Describe the real-world professional domain, source inspiration, and why the task requires domain expertise."),
    "",
    "COPY BLOCK 2 - Expertise Level Target",
    "----------------------------------------------",
    expertiseLabel(fields.expertise),
    "",
    "COPY BLOCK 3 - Prompt",
    "----------------------------------------------",
    packageText(fields.prompt, "Write the exact prompt that will be provided to the agent."),
    "",
    "COPY BLOCK 4 - Resources Needed To Solve The Task",
    "----------------------------------------------",
    packageText(fields.resources, "List every dataset, file, package, public source, version, and setup artifact the agent needs."),
    "",
    "COPY BLOCK 5 - Golden Solution As Granular As Possible",
    "----------------------------------------------",
    packageText(fields.solution, "Provide the solve path, including commands, code/scripts, checks, and expected outputs."),
    "",
    "COPY BLOCK 6 - Golden Solution Rubric",
    "----------------------------------------------",
    buildGoldenSolutionRubric(fields),
    "",
    "COPY BLOCK 7 - Difficulty Explanation",
    "----------------------------------------------",
    packageText(fields.difficulty, "Explain why this is hard, why common automated approaches may fail, and why it requires domain expertise."),
    "",
    "COPY BLOCK 8 - Professional Time Estimate",
    "----------------------------------------------",
    packageText(fields.time, "Estimate how long a qualified professional would need."),
    "",
    "COPY BLOCK 9 - Verifiers Description",
    "----------------------------------------------",
    packageText(fields.verifiers, "Describe deterministic checks that accept correct outputs and reject incorrect outputs."),
    "",
    "COPY BLOCK 10 - Submission Rubric",
    "----------------------------------------------",
    buildSubmissionRubric(fields),
    "",
    "COPY BLOCK 11 - Optional Agent Difficulty Check",
    "----------------------------------------------",
    packageText(fields.agentCheck, "Summarize terminal-agent testing only if you performed it."),
    "",
    "INTERNAL CHECKLIST - Do Not Submit Unless Needed",
    "----------------------------------------------",
    getTaskChecks(fields).map((check) => `${check.pass ? "PASS" : "NEEDS WORK"} - ${check.title}: ${check.message}`).join("\n")
  ].join("\n");
}

const DOMAIN_DRAFTS = {
  "biomedical-signal": {
    brief: "Validate beat-detection results for selected PhysioNet ECG records after a signal-cleaning pipeline change",
    domain: "biomedical signal processing using public ECG or PPG waveform data, clinical signal-quality constraints, and reproducible Python analysis",
    artifact: "a CSV report and validation plot",
    method: "wavelet denoising, notch filtering, peak detection, beat-level feature extraction, and tolerance-based validation against reference annotations",
    data: "MIT-BIH-style waveform segments, annotation files, sampling-rate metadata, and a channel manifest",
    failure: "filter leakage, incorrect sampling-rate conversion, false peak matching, and accepting visually plausible but clinically invalid beat intervals",
    sourceKit: "PhysioNet MIT-BIH Arrhythmia Database records 100, 101, and 103 exported as records.csv, annotations.csv, sampling_metadata.json, and a README with the 360 Hz sampling rate and signal-unit notes"
  },
  "climate-geospatial": {
    brief: "Audit county-level heat anomaly outputs built from NOAA station data and boundary files",
    domain: "climate and geospatial analytics using station observations, raster grids, coordinate transforms, and reproducible regional aggregation",
    artifact: "a GeoJSON layer and a CSV anomaly table",
    method: "spatial joins, CRS normalization, temporal baseline construction, raster sampling, and uncertainty-aware regional aggregation",
    data: "station CSV files, a region boundary GeoJSON, gridded NetCDF or GeoTIFF data, and metadata describing units and coordinate reference systems",
    failure: "mixing coordinate systems, leaking target-period values into baselines, mishandling missing stations, and producing maps that cannot be verified numerically",
    sourceKit: "NOAA GHCN Daily station observations, a TIGER/Line county boundary GeoJSON, station_metadata.csv, daily_observations.csv, county_boundaries.geojson, and crs_notes.md"
  },
  "computational-biology": {
    brief: "Review promoter motif hits after a genome annotation update changed candidate loci",
    domain: "computational biology using sequence data, public gene annotations, reproducible alignment-derived features, and biologically meaningful constraints",
    artifact: "a ranked TSV of candidate loci and a machine-readable QC summary",
    method: "sequence parsing, motif scanning, multiple-testing correction, genomic interval joins, and reference-based validation",
    data: "FASTA sequences, GFF/GTF annotations, sample metadata, and a known reference motif table",
    failure: "off-by-one genomic coordinates, strand errors, invalid multiple-testing correction, and biologically implausible candidates",
    sourceKit: "Ensembl or NCBI RefSeq chromosome slice exports packaged as genome_slice.fa, annotations.gff3, sample_manifest.csv, jaspar_motifs.tsv, and coordinate_conventions.md"
  },
  "quant-finance": {
    brief: "Reconcile portfolio risk metrics after a corporate-action adjustment changed historical returns",
    domain: "quantitative finance using market microstructure data, corporate-action adjustments, and reproducible risk metric computation",
    artifact: "a portfolio risk report in CSV and JSON",
    method: "return normalization, volatility estimation, drawdown analysis, factor exposure regression, and out-of-sample validation",
    data: "OHLCV price files, corporate-action tables, factor-return files, and a portfolio holdings file",
    failure: "look-ahead bias, unadjusted splits, incorrect annualization, unstable regression windows, and unverifiable prose-only risk conclusions",
    sourceKit: "Stooq or Nasdaq Data Link daily OHLCV exports for selected tickers, Fama-French factor CSVs, corporate_actions.csv, holdings.csv, and trading_calendar.csv"
  },
  "materials-science": {
    brief: "Screen crystal structures for duplicate or invalid candidates before a property-ranking handoff",
    domain: "materials science using crystallographic structure files, composition descriptors, and reproducible property-screening logic",
    artifact: "a ranked materials table and structure-level validation summary",
    method: "CIF parsing, stoichiometry checks, descriptor generation, symmetry-aware filtering, and threshold-based property ranking",
    data: "CIF files, a composition metadata CSV, reference property measurements, and package/version notes for pymatgen or ASE",
    failure: "invalid oxidation-state assumptions, duplicate structures, unit mistakes, and rankings that ignore crystal symmetry constraints",
    sourceKit: "Crystallography Open Database CIF samples, cod_metadata.csv, reference_properties.csv, pymatgen_version.txt, and structure_id_mapping.csv"
  },
  "power-systems": {
    brief: "Rank N-1 contingency violations for a MATPOWER-style test case after solver settings changed",
    domain: "power systems engineering using load-flow cases, bus/branch tables, generator constraints, and reproducible contingency analysis",
    artifact: "a contingency ranking CSV and voltage-violation report",
    method: "AC or DC load-flow computation, N-1 contingency screening, constraint checking, and tolerance-based comparison to reference cases",
    data: "bus, branch, generator, and load tables plus base-MVA metadata and solver package versions",
    failure: "per-unit conversion errors, slack-bus mishandling, ignored thermal limits, and non-reproducible solver settings",
    sourceKit: "MATPOWER case files such as case14 and case30 exported as bus.csv, branch.csv, gen.csv, load_profile.csv, base_mva.json, and solver_config.yaml"
  },
  "cyber-forensics": {
    brief: "Reconcile Zeek network events with endpoint process logs for a suspected phishing intrusion",
    domain: "cybersecurity forensics using packet captures, endpoint logs, file hashes, and reproducible incident-timeline reconstruction",
    artifact: "a JSON incident timeline and IOC table",
    method: "PCAP parsing, timestamp normalization, session reconstruction, hash matching, and rule-based event correlation",
    data: "PCAP files, endpoint event logs, hash allow/block lists, and schema documentation for event fields",
    failure: "timezone drift, conflating benign retries with compromise, missing correlated events, and relying on screenshots instead of parsed evidence",
    sourceKit: "Stratosphere IPS CTU-style PCAP slices or Malware-Traffic-Analysis exercise logs packaged as traffic.pcap, zeek_conn.log, zeek_dns.log, edr_events.jsonl, known_hashes.csv, and timezone_notes.md"
  },
  "robotics-control": {
    brief: "Audit a mobile robot trajectory controller using run logs from warehouse test routes",
    domain: "robotics and control using trajectory logs, actuator limits, controller parameters, and reproducible stability or tracking analysis",
    artifact: "a metrics JSON file and trajectory-error CSV",
    method: "state-estimation checks, controller-response simulation, tracking-error computation, and constraint violation detection",
    data: "trajectory logs, robot parameter YAML, reference path files, and controller configuration files",
    failure: "frame-transform mistakes, unstable discretization, hidden actuator-limit violations, and metrics that reward smooth but inaccurate paths",
    sourceKit: "ROS bag-derived trajectory CSVs, robot_params.yaml, reference_path.csv, controller_config.yaml, actuator_limits.json, and frame_conventions.md"
  },
  econometrics: {
    brief: "Reproduce a treatment-effect report after an update changed panel cleaning rules",
    domain: "econometrics and policy analysis using panel data, treatment timing, fixed effects, and reproducible robustness checks",
    artifact: "a regression summary CSV and robustness-check JSON",
    method: "panel cleaning, difference-in-differences estimation, clustered standard errors, placebo tests, and pre-trend diagnostics",
    data: "panel outcome data, treatment timing tables, covariate files, and a data dictionary",
    failure: "bad treatment timing, wrong fixed effects, unclustered errors, post-treatment controls, and conclusions not tied to computed estimates",
    sourceKit: "World Bank or IPUMS-style panel extracts packaged as panel_outcomes.csv, treatment_timing.csv, covariates.csv, data_dictionary.md, and pretrend_windows.json"
  },
  "computational-linguistics": {
    brief: "Analyze label-level parser errors after a tokenizer version changed corpus boundaries",
    domain: "computational linguistics using annotated corpora, morphology or syntax labels, and reproducible corpus-level evaluation",
    artifact: "an error-analysis table and metrics JSON",
    method: "corpus parsing, stratified metric computation, agreement analysis, tokenization checks, and label-level confusion analysis",
    data: "annotated text files, label schema documentation, train/test split manifests, and tokenizer version notes",
    failure: "label leakage, token-boundary drift, invalid averaging, and unsupported linguistic conclusions",
    sourceKit: "Universal Dependencies treebank samples packaged as train.conllu, test.conllu, label_schema.md, split_manifest.json, tokenizer_version.txt, and gold_metrics.json"
  },
  "software-engineering": {
    brief: "Triage a real repository regression where a fix may have broken an existing public API contract",
    domain: "software engineering using real repository history, failing regression tests, API compatibility constraints, and reproducible build artifacts",
    artifact: "a patch file, test report, and compatibility summary JSON",
    method: "static analysis, targeted refactoring, regression-test minimization, dependency graph inspection, and behavioral compatibility checks",
    data: "a repository snapshot, failing test logs, API documentation, dependency lockfiles, and benchmark fixtures",
    failure: "fixing symptoms instead of root causes, breaking public APIs, hiding failures with brittle test changes, and missing edge-case regressions",
    sourceKit: "a pinned open-source repository snapshot with bug_repro.md, failing_tests.txt, api_contract.md, package-lock.json or poetry.lock, regression_fixtures/, and expected_behavior.json"
  },
  "computer-science": {
    brief: "Build adversarial test coverage for an algorithm implementation with strict complexity constraints",
    domain: "computer science algorithms using formal input constraints, asymptotic requirements, generated adversarial cases, and reproducible correctness testing",
    artifact: "an implementation file, complexity note, and adversarial test-results JSON",
    method: "algorithm design, proof-informed invariant checking, randomized stress testing, edge-case generation, and asymptotic performance validation",
    data: "problem specification files, seedable case generators, hidden reference outputs, and performance budget metadata",
    failure: "passing small examples with an exponential solution, mishandling boundary conditions, relying on unstable heuristics, and giving an implementation with no verifiable complexity behavior",
    sourceKit: "problem_statement.md, constraints.json, seed_generator.py, public_cases.jsonl, adversarial_cases.jsonl, reference_outputs.jsonl, and runtime_budget.json"
  },
  "distributed-systems": {
    brief: "Replay distributed event histories to find a consistency violation under partition timing changes",
    domain: "distributed systems using event traces, consistency invariants, network partition scenarios, and reproducible simulation logs",
    artifact: "a consistency-violation report and replayable trace summary JSON",
    method: "trace replay, happens-before reconstruction, invariant checking, quorum analysis, and deterministic fault-injection simulation",
    data: "node event logs, message trace files, configuration manifests, clock-skew metadata, and expected invariant definitions",
    failure: "assuming total ordering where none exists, ignoring delayed messages, missing split-brain cases, and producing conclusions not tied to replayed traces",
    sourceKit: "Jepsen-style event histories packaged as history.edn or history.jsonl, node_configs.yaml, partition_windows.csv, invariant_spec.md, and expected_counterexamples.json"
  },
  databases: {
    brief: "Diagnose why a reporting query regressed after planner statistics and index changes",
    domain: "database systems using query plans, transaction logs, indexes, statistics, and reproducible optimizer or isolation-level analysis",
    artifact: "a query-plan diagnosis report, rewritten SQL file, and benchmark metrics CSV",
    method: "query-plan inspection, cardinality-estimation analysis, index design, transaction anomaly detection, and repeatable benchmark comparison",
    data: "SQL schema dumps, sample tables, query workloads, transaction traces, planner outputs, and database version metadata",
    failure: "optimizing for one sample query only, ignoring isolation anomalies, using non-repeatable timings, and proposing indexes that violate workload constraints",
    sourceKit: "TPC-H or Join Order Benchmark-inspired schema.sql, sample_data/, workload.sql, explain_plans_before.json, explain_plans_after.json, transaction_traces.csv, and postgres_version.txt"
  },
  compilers: {
    brief: "Check whether a compiler optimization pass preserves semantics on targeted source fixtures",
    domain: "compilers and static analysis using source programs, intermediate representation dumps, optimization passes, and semantic-preservation tests",
    artifact: "a compiler-pass patch, IR diff report, and semantic test-results JSON",
    method: "control-flow graph analysis, data-flow analysis, SSA reasoning, optimization legality checks, and differential testing against reference execution",
    data: "source fixtures, grammar or IR documentation, expected outputs, compiler flags, and pass-pipeline configuration files",
    failure: "performing an unsound optimization, mishandling undefined behavior, breaking scoping or type rules, and passing syntactic tests while changing program semantics",
    sourceKit: "LLVM-lit-style fixtures or small language programs packaged as tests/input/, expected_stdout/, ir_before.ll, pass_pipeline.txt, grammar.md, and compiler_flags.txt"
  },
  "ml-systems": {
    brief: "Audit batch-versus-online prediction drift after a feature pipeline migration",
    domain: "machine learning systems using model-serving traces, feature pipelines, latency budgets, and reproducible offline evaluation",
    artifact: "a metrics JSON file, drift report, and serving-latency summary",
    method: "feature validation, calibration analysis, drift detection, latency profiling, batch/online parity checks, and threshold selection",
    data: "feature snapshots, prediction logs, ground-truth labels, model metadata, service traces, and evaluation configuration files",
    failure: "leaking labels, optimizing aggregate accuracy while failing slices, ignoring calibration, breaking batch/online parity, and using unstable latency measurements",
    sourceKit: "OpenML-style tabular snapshot or model-serving logs packaged as features.parquet, labels.csv, prediction_logs.jsonl, model_card.md, slice_definitions.yaml, and latency_trace.csv"
  },
  "applied-math": {
    brief: "Validate convergence and boundary-condition handling for a numerical solver output",
    domain: "applied mathematics using numerical methods, boundary conditions, convergence criteria, and reproducible error analysis",
    artifact: "a numerical solution table, convergence plot data, and error-bound report",
    method: "discretization, stability analysis, convergence testing, residual computation, and tolerance-based comparison to analytic or high-resolution reference solutions",
    data: "parameter files, boundary-condition definitions, reference solutions, mesh or grid specifications, and numerical tolerance requirements",
    failure: "using an unstable discretization, confusing local and global error, failing boundary conditions, and reporting plausible numbers without convergence evidence",
    sourceKit: "parameter_config.yaml, boundary_conditions.json, reference_solution.csv, mesh_levels/, tolerance_spec.json, and analytic_case_notes.md"
  },
  statistics: {
    brief: "Investigate why a treatment-effect analysis changed after missing-data handling was updated",
    domain: "statistics and experimental design using raw observations, treatment assignments, missingness patterns, and reproducible inference checks",
    artifact: "a statistical analysis report CSV, model diagnostics JSON, and reproducibility notes",
    method: "power analysis, missing-data handling, model specification, multiple-testing correction, sensitivity analysis, and assumption diagnostics",
    data: "raw observation tables, treatment metadata, data dictionaries, pre-specified hypotheses, and analysis configuration files",
    failure: "p-hacking through multiple comparisons, invalid independence assumptions, mishandling missingness, and reporting significant results without diagnostic support",
    sourceKit: "Kaggle/UCI-style raw observations packaged as observations.csv, treatment_assignments.csv, missingness_flags.csv, hypotheses.yaml, and analysis_plan.md"
  },
  "scientific-computing": {
    brief: "Verify a solver run against conservation and residual targets after parameter changes",
    domain: "scientific computing using simulation inputs, numerical solvers, physical constraints, and reproducible high-precision validation",
    artifact: "a solver output file, residual-history CSV, and conservation-check JSON",
    method: "solver configuration, residual tracking, convergence analysis, conservation-law checks, parameter sweeps, and tolerance-based reference comparison",
    data: "simulation input files, parameter manifests, reference outputs, unit definitions, and package/compiler version notes",
    failure: "accepting non-converged runs, violating conservation constraints, mixing units, and using nondeterministic solver settings without documenting tolerances",
    sourceKit: "solver_inputs/, parameters.yaml, unit_definitions.md, reference_outputs.csv, residual_targets.json, compiler_version.txt, and deterministic_seed.txt"
  },
  "formal-methods": {
    brief: "Replay a model-checking counterexample and verify that the stated invariant is strong enough",
    domain: "formal methods using specifications, transition systems, invariants, and reproducible model-checking or proof-assistant artifacts",
    artifact: "a machine-checkable proof or counterexample trace plus an invariant coverage report",
    method: "state-space modeling, invariant strengthening, counterexample minimization, temporal-logic checking, and proof obligation validation",
    data: "formal specifications, model files, property definitions, expected counterexamples or theorem statements, and tool-version metadata",
    failure: "proving a weaker property than requested, missing liveness cases, relying on informal reasoning, and producing traces that cannot be replayed",
    sourceKit: "TLA+/Alloy/Coq-style specs packaged as model.tla or model.als, properties.md, expected_counterexample.json, tool_versions.txt, and run_model_check.sh"
  }
};

const TYPE_DRAFTS = {
  analysis: {
    verb: "Compute",
    focus: "a reproducible analysis artifact",
    verifier: "compare generated metrics and output files against hidden reference outputs"
  },
  simulation: {
    verb: "Simulate",
    focus: "a numerical model result under specified constraints",
    verifier: "compare simulation outputs against reference tolerances and conservation or stability checks"
  },
  verification: {
    verb: "Produce",
    focus: "an output designed to pass deterministic verification",
    verifier: "run strict schema, value, and edge-case checks against the submitted output"
  },
  optimization: {
    verb: "Optimize",
    focus: "a calibrated parameter set or ranked decision artifact",
    verifier: "check objective value, constraint satisfaction, and reproducibility against reference thresholds"
  }
};

const STANDARD_DRAFTS = {
  enterprise: {
    label: "Enterprise production",
    prompt: "Make the handoff production-ready: stable file paths, explicit schemas, rerunnable commands, and clear failure handling.",
    resources: "Include CI-style test instructions, a lockfile or version manifest, sample and edge-case inputs, expected output schemas, and operational notes for rerunning the workflow from a clean checkout.",
    verifier: "The verifier should behave like a CI gate: deterministic, repeatable, schema-aware, tolerant only where specified, and strict about missing artifacts, unstable ordering, and regression cases.",
    rubric: "Enterprise pass criteria: reproducible from clean checkout, documented schemas, stable artifacts, operational edge cases, clear failure modes, and verifier behavior suitable for a CI gate."
  },
  regulated: {
    label: "Regulated / audited",
    prompt: "Make the handoff audit-ready: trace each output back to inputs, document assumptions, and account for exclusions.",
    resources: "Include a data dictionary, provenance notes, allowed exclusions, package versions, audit log expectations, and examples of valid and invalid records.",
    verifier: "The verifier should check traceability, required audit fields, exclusion accounting, exact schema, deterministic calculations, and tolerance rules.",
    rubric: "Regulated pass criteria: traceable inputs, documented assumptions, auditable exclusions, deterministic calculations, and independently reviewable evidence."
  },
  research: {
    label: "Research benchmark",
    prompt: "Make the handoff benchmark-ready: include baseline comparisons, strict metrics, and reproducibility notes.",
    resources: "Include benchmark splits, baseline outputs, seed values, metric definitions, reference configs, and notes that prevent leakage or invalid comparison.",
    verifier: "The verifier should check metric definitions, split integrity, seed reproducibility, baseline comparison, tolerance bands, and required ablation or sensitivity outputs.",
    rubric: "Research pass criteria: valid benchmark setup, leakage prevention, meaningful baselines, reproducible metrics, and clear failure analysis."
  }
};

const SCENARIO_STYLES = [
  {
    name: "post-migration validation",
    situation: "after a production data or system migration",
    objective: "identify where the migrated outputs diverge from the trusted reference and produce an auditable exception report",
    resource: "before/after extracts, migration mapping tables, reference outputs, and a small set of intentionally malformed edge-case records",
    solution: "compare old and new outputs by stable keys, classify each mismatch by failure type, compute summary rates, and preserve row-level evidence for every rejected or changed record",
    verifier: "check exact mismatch categories, row counts, reference joins, stable ordering, and whether known malformed records are rejected for the right reason",
    composePrompt(profile, type, standard) {
      return [
        `We need a migration validation pass: ${profile.brief}.`,
        `Compare the legacy and migrated outputs and produce ${profile.artifact} showing every material divergence, the reason code for the divergence, and the source records needed to audit it.`,
        `The deliverable should be usable by an engineering review team: ${standard.prompt}`
      ].join("\n\n");
    }
  },
  {
    name: "regression triage",
    situation: "after a new release caused a measurable regression in a previously stable workflow",
    objective: "isolate the smallest reproducible regression case and return a machine-readable diagnosis with the failing condition",
    resource: "two versioned output folders, failing logs, configuration diffs, seed values, and expected baseline metrics",
    solution: "re-run the baseline and candidate workflows, bisect configuration differences, compute metric deltas, and produce a minimal failing case with evidence",
    verifier: "confirm the reported failing case reproduces, the metric delta matches reference tolerance, and unrelated changes are not mislabeled as root causes",
    composePrompt(profile, type, standard) {
      return [
        `A previously stable workflow regressed: ${profile.brief}.`,
        `Find the smallest reproducible failing case, explain the failing condition in machine-readable form, and return ${profile.artifact}.`,
        "The result should separate the root cause from unrelated output drift and include enough evidence for someone else to rerun the failure.",
        standard.prompt
      ].join("\n\n");
    }
  },
  {
    name: "compliance audit",
    situation: "during a scheduled audit of a regulated or high-stakes workflow",
    objective: "produce an audit-ready evidence package that traces every final output back to validated inputs and documented exclusions",
    resource: "raw inputs, data dictionary, exclusion rules, expected output schema, audit log template, and package version manifest",
    solution: "validate schemas, apply exclusion rules, record every accepted and rejected input, compute final outputs, and generate traceability metadata",
    verifier: "check traceability fields, exclusion accounting, exact schema, version metadata, and deterministic recalculation of final values",
    composePrompt(profile, type, standard) {
      return [
        `Prepare an audit-ready evidence package: ${profile.brief}.`,
        `Return ${profile.artifact} with traceability from each final output back to validated inputs, documented exclusions, and any assumptions used in the calculation.`,
        "The output should make it clear which records were accepted, which were rejected, and why.",
        standard.prompt
      ].join("\n\n");
    }
  },
  {
    name: "edge-case benchmark",
    situation: "while building a benchmark intended to catch subtle expert-level failures",
    objective: "generate the required output and a failure-analysis table for edge cases that ordinary happy-path solutions miss",
    resource: "normal fixtures, edge-case fixtures, invalid inputs, reference outputs, and a manifest describing which cases target which failure modes",
    solution: "run the workflow on normal, edge, and invalid fixtures; compute outputs; label failure modes; and summarize which constraints each case exercises",
    verifier: "assert normal-case correctness, edge-case handling, invalid-input rejection, failure-mode labels, and reproducibility across repeated runs",
    composePrompt(profile, type, standard) {
      return [
        `Build an edge-case benchmark: ${profile.brief}.`,
        `The output should include ${profile.artifact} plus a failure-analysis table that shows which cases target normal behavior, boundary behavior, invalid input handling, and domain-specific failure modes.`,
        "Make the final artifacts deterministic and easy to grade without reading the solver's reasoning.",
        standard.prompt
      ].join("\n\n");
    }
  },
  {
    name: "operational reconciliation",
    situation: "when two trusted operational systems disagree and the downstream team needs a defensible reconciliation",
    objective: "reconcile the systems into a final output table with reason codes, confidence flags, and a review queue for unresolved records",
    resource: "two system exports, schema documentation, precedence rules, timestamp metadata, and a set of known reconciliation examples",
    solution: "normalize identifiers, align timestamps, apply precedence rules, classify conflicts, compute final reconciled records, and emit unresolved cases separately",
    verifier: "check conflict classification, precedence handling, timestamp normalization, exact output schema, and whether known examples receive the expected reason codes",
    composePrompt(profile, type, standard) {
      return [
        `Two trusted operational sources disagree: ${profile.brief}.`,
        `Reconcile them into ${profile.artifact}, including final selected values, conflict reason codes, confidence flags, and a separate unresolved-record queue.`,
        "The deliverable should let a downstream team understand every changed or unresolved record from the output files alone.",
        standard.prompt
      ].join("\n\n");
    }
  }
];

const DOMAIN_DETAILS = {
  "biomedical-signal": {
    sources: [
      "PhysioNet MIT-BIH Arrhythmia Database v1.0.0: https://physionet.org/content/mitdb/1.0.0/",
      "PhysioNet file directory for records such as 100, 101, and 103: https://physionet.org/files/mitdb/1.0.0/"
    ],
    resources: [
      "data/raw/mitdb_100_signal.csv, mitdb_101_signal.csv, mitdb_103_signal.csv with columns record_id, sample_index, time_sec, mlII_mv, v5_mv.",
      "data/reference/beat_annotations.csv with record_id, annotation_sample, annotation_time_sec, beat_symbol, source_record.",
      "config/filter_change.yaml describing the old and new high-pass, notch, and denoising settings.",
      "schemas/beat_report.schema.json requiring record_id, beat_index, detected_time_sec, nearest_annotation_time_sec, abs_error_ms, match_status, exclusion_reason.",
      "verifier_inputs/normal_record_100.csv, edge_noisy_segment_101.csv, invalid_sampling_rate_103.csv, and expected_metrics.json."
    ],
    solution: [
      "Implement solve.py with commands such as python solve.py --input data --config config/filter_change.yaml --out outputs.",
      "Load each ECG record, verify the 360 Hz sampling rate, check monotonic sample_index values, and compute input checksums before processing.",
      "Apply the stated cleaning change, detect candidate R peaks, match detections to reference annotations within the declared millisecond tolerance, and flag unmatched detections separately from rejected records.",
      "Write outputs/beat_validation_report.csv, outputs/validation_metrics.json, outputs/plots/record_overlay.png, and outputs/run_manifest.json.",
      "The report must expose record_id, sample ranges, filter parameters, beat counts, sensitivity, PPV, false positives, false negatives, exclusion_reason, and source checksum."
    ],
    verifiers: [
      "Assert the 360 Hz metadata is used rather than inferred from row count.",
      "Check beat matching against hidden reference rows within the stated tolerance.",
      "Fail if an invalid sampling-rate fixture is accepted or if noisy edge cases lose traceability."
    ]
  },
  "computational-biology": {
    sources: [
      "Ensembl human GRCh38 downloads: https://www.ensembl.org/info/data/ftp/index.html",
      "JASPAR CORE transcription-factor binding profiles: https://jaspar.elixir.no/docs/",
      "Bioconductor JASPAR2024 data package: https://bioconductor.org/packages/JASPAR2024/"
    ],
    resources: [
      "data/genome_slice.fa containing chr7:55,000,000-55,120,000 from GRCh38 with sequence IDs matching coordinate_conventions.md.",
      "data/annotations.gff3 with gene, transcript, exon, and promoter_window features using 1-based closed genomic coordinates.",
      "data/jaspar_motifs.tsv with motif_id, motif_name, pwm_json, min_score, strand_policy, and expected_family.",
      "data/reference_hits.tsv with a small curated set of expected motif hits for normal, boundary, reverse-strand, and invalid-coordinate cases.",
      "schemas/candidate_loci.schema.json and schemas/qc_summary.schema.json defining ranked_loci.tsv and qc_summary.json.",
      "verifier_inputs/normal_promoter.fa, edge_reverse_strand_boundary.gff3, invalid_off_by_one_annotation.gff3, and expected_candidate_loci.tsv."
    ],
    solution: [
      "Implement solve.py with a command such as python solve.py --fasta data/genome_slice.fa --gff data/annotations.gff3 --motifs data/jaspar_motifs.tsv --out outputs.",
      "Validate FASTA identifiers, GFF3 coordinate conventions, promoter-window bounds, motif score thresholds, and strand policy before scanning.",
      "Extract promoter windows, scan both strands only where allowed, compute motif scores, join hits to gene/transcript annotations, and apply the configured multiple-testing correction.",
      "Write outputs/ranked_loci.tsv, outputs/qc_summary.json, outputs/failure_analysis.tsv, outputs/rejected_inputs.tsv, and outputs/run_manifest.json.",
      "The ranked TSV must include candidate_id, seq_id, gene_id, transcript_id, motif_id, strand, start_1based, end_1based, raw_score, adjusted_p_value, rank, source_file, and failure_mode_target."
    ],
    verifiers: [
      "Assert 1-based GFF3 coordinates are converted correctly when slicing the FASTA sequence.",
      "Fail if reverse-strand motif hits are dropped or if invalid promoter windows are silently clipped.",
      "Check ranked_loci.tsv, qc_summary.json, and failure_analysis.tsv against hidden reference rows and expected reason codes."
    ]
  },
  "computer-science": {
    sources: [
      "Self-contained benchmark source: include the full problem statement, generated fixtures, seeds, and reference outputs in the zip.",
      "If inspired by a public benchmark or repository, cite the exact URL, commit, release, or paper DOI in README.md."
    ],
    resources: [
      "problem/problem_statement.md describing an interval-query algorithm with n, q, value ranges, expected output format, and asymptotic target.",
      "problem/constraints.json with maximum n, maximum q, memory_limit_mb, time_limit_ms, and forbidden_complexity_classes.",
      "generators/seed_generator.py and generators/adversarial_case_generator.py with fixed seeds and documented case families.",
      "cases/public_cases.jsonl, cases/adversarial_cases.jsonl, cases/migration_before_outputs.jsonl, and cases/migration_after_outputs.jsonl.",
      "schemas/solution_output.schema.json, schemas/test_results.schema.json, and verifier_inputs/expected_divergences.json."
    ],
    solution: [
      "Implement solve.py or src/solution.py plus python run_cases.py --cases cases --out outputs/test_results.json.",
      "Validate input constraints, generate deterministic adversarial cases, run legacy and migrated outputs, and classify divergences by stable case_id.",
      "Prove or justify the asymptotic bound in outputs/complexity_note.md using invariants tied to the implemented data structure.",
      "Write outputs/solution.py, outputs/test_results.json, outputs/divergence_report.json, outputs/complexity_note.md, and outputs/run_manifest.json.",
      "The divergence report must include case_id, generator_seed, input_size, expected_output, actual_output, mismatch_type, and minimal_repro_case."
    ],
    verifiers: [
      "Fail if the implementation passes public cases but exceeds the declared asymptotic target on generated adversarial cases.",
      "Check exact mismatch categories and minimal reproducer IDs against expected_divergences.json.",
      "Run repeated seeded case generation and assert stable outputs, runtime budget compliance, and schema validity."
    ]
  },
  "applied-math": {
    sources: [
      "Self-contained numerical benchmark source: include the analytic case notes, reference solution, mesh files, tolerance spec, and solver configuration in the zip.",
      "If adapted from a public paper or textbook benchmark, cite the exact paper DOI, equation number, and boundary-condition definition in README.md."
    ],
    resources: [
      "config/parameter_config.yaml with equation_id, coefficient values, grid sizes, solver tolerances, and random_seed if used.",
      "config/boundary_conditions.json defining Dirichlet and Neumann conditions with units and boundary labels.",
      "data/reference_solution.csv from a high-resolution or analytic reference with x, t, u_reference, and reference_error_bound columns.",
      "data/mesh_levels/mesh_32.csv, mesh_64.csv, mesh_128.csv, and mesh_256.csv with node_id, x, dx, and boundary_label.",
      "schemas/numerical_solution.schema.json, schemas/convergence.schema.json, schemas/error_report.schema.json, and verifier_inputs/unstable_boundary_case.yaml."
    ],
    solution: [
      "Implement solve.py with python solve.py --params config/parameter_config.yaml --bc config/boundary_conditions.json --mesh data/mesh_levels --out outputs.",
      "Validate boundary labels, mesh monotonicity, coefficient units, solver tolerances, and reference-solution alignment before computing errors.",
      "Run the solver for each mesh level, compute residual norms, boundary residuals, L2/Linf errors, observed convergence rate, and stability flags.",
      "Write outputs/numerical_solution.csv, outputs/convergence_data.csv, outputs/error_bound_report.json, outputs/regression_diagnosis.json, and outputs/run_manifest.json.",
      "The regression diagnosis must name the smallest mesh/configuration pair that reproduces the failing boundary or convergence condition."
    ],
    verifiers: [
      "Check observed convergence rates and residuals against reference tolerances for each mesh level.",
      "Fail if boundary conditions are satisfied only approximately outside the declared tolerance or if local/global error is mislabeled.",
      "Assert that the reported minimal failing case reproduces from the provided parameters."
    ]
  },
  "robotics-control": {
    resources: [
      "data/routes/route_a_reference.csv and route_b_reference.csv with timestamp_ns, frame_id, x_m, y_m, yaw_rad, v_ref_mps.",
      "data/logs/controller_run_01.csv and controller_run_02.csv with odom pose, command velocity, actuator saturation flags, and controller mode.",
      "config/robot_params.yaml, controller_config.yaml, actuator_limits.json, frame_conventions.md, and expected_output_schema.json.",
      "verifier_inputs/normal_tracking_run.csv, edge_saturation_run.csv, invalid_frame_id_run.csv, and reference_metrics.json."
    ],
    solution: [
      "Implement solve.py that validates frame conventions, timestamp monotonicity, controller parameters, and actuator-limit units before computing metrics.",
      "Align reference and executed trajectories by timestamp, interpolate only under the allowed gap threshold, and compute cross-track error, heading error, RMS error, max error, settling behavior, and saturation intervals.",
      "Write outputs/trajectory_error.csv, outputs/metrics.json, outputs/exclusions.csv, and outputs/run_manifest.json.",
      "Classify each run as accepted, excluded, or review_required with reason codes tied to frame mismatch, missing samples, actuator saturation, or tracking tolerance failure."
    ],
    verifiers: [
      "Assert coordinate-frame conversion and units by checking known transformed points.",
      "Fail if actuator-limit violations are hidden inside aggregate tracking metrics.",
      "Compare RMS and max error values to reference tolerances with deterministic ordering."
    ]
  },
  "ml-systems": {
    resources: [
      "data/features/batch_features.parquet and online_features.parquet with stable entity_id, event_time, feature_version, and named feature columns.",
      "data/predictions/batch_predictions.csv, online_predictions.jsonl, labels.csv, slice_definitions.yaml, latency_trace.csv, and model_card.md.",
      "config/evaluation.yaml with thresholds for parity, drift, calibration, latency percentiles, and slice-level failure rules.",
      "verifier_inputs/normal_slice.csv, edge_missing_feature.parquet, invalid_label_leakage_case.csv, and expected_metrics.json."
    ],
    solution: [
      "Implement solve.py that joins predictions, labels, features, and slice definitions by stable keys and rejects rows with timestamp or schema violations.",
      "Compute batch/online parity, feature drift, calibration, slice metrics, latency p50/p95/p99, and threshold breaches.",
      "Write outputs/metrics.json, outputs/drift_report.csv, outputs/latency_summary.csv, outputs/exceptions.csv, and outputs/run_manifest.json.",
      "Separate model-quality regressions from feature-pipeline mismatches and serving-latency breaches."
    ],
    verifiers: [
      "Fail if labels are joined before the allowed event time or if leakage fixtures pass.",
      "Check slice-level metrics, not only aggregate accuracy.",
      "Assert exact schema and reference metric tolerances for parity, drift, and latency."
    ]
  },
  databases: {
    resources: [
      "db/schema.sql, db/sample_data/, workload/reporting_query.sql, plans/explain_before.json, plans/explain_after.json, stats/table_stats_before_after.csv, and db/postgres_version.txt.",
      "constraints/index_budget.yaml, workload_frequency.csv, expected_output_schema.json, and verifier_inputs/known_bad_plan.json.",
      "README.md describing row counts, indexes, isolation assumptions, and how to restore the database snapshot."
    ],
    solution: [
      "Implement solve.py or analysis.sql plus a runner that restores the provided snapshot, loads plan JSON, and normalizes plan nodes.",
      "Compare estimated versus actual cardinalities, join order changes, index usage, sort/hash spill indicators, and timing deltas under repeated runs.",
      "Write outputs/query_plan_diagnosis.md, outputs/rewrite.sql, outputs/benchmark_metrics.csv, and outputs/root_cause.json.",
      "Identify the smallest reproducible query or statistics condition that triggers the regression."
    ],
    verifiers: [
      "Check that diagnosis cites exact plan nodes and metric deltas.",
      "Fail if the rewrite violates the index budget or changes result rows.",
      "Require repeated timing medians rather than a single non-repeatable run."
    ]
  },
  statistics: {
    resources: [
      "data/observations.csv, treatment_assignments.csv, missingness_flags.csv, covariates.csv, hypotheses.yaml, and analysis_plan.md.",
      "config/model_spec.yaml with estimand, alpha level, clustering rules, missing-data policy, and multiple-testing correction.",
      "verifier_inputs/normal_panel.csv, edge_all_missing_stratum.csv, invalid_post_treatment_covariate.csv, and expected_estimates.json."
    ],
    solution: [
      "Implement solve.py that validates randomization or treatment timing, missingness rules, covariate timing, and hypothesis IDs.",
      "Run the specified inference model, diagnostics, sensitivity checks, and multiple-testing correction with deterministic seeds where needed.",
      "Write outputs/statistical_analysis_report.csv, outputs/model_diagnostics.json, outputs/reproducibility_notes.md, and outputs/exclusions.csv.",
      "Explain any rejected rows through structured reason codes rather than free-text-only notes."
    ],
    verifiers: [
      "Fail if post-treatment covariates are used or missingness exclusions are unaccounted for.",
      "Check estimates, confidence intervals, p-values, and correction procedure against reference tolerances.",
      "Require diagnostics and row counts to reconcile with exclusions."
    ]
  }
};

function fillStarterTemplate() {
  const confirmed = hasTaskDraft() ? confirm("Replace the current draft with a generated domain draft?") : true;
  if (!confirmed) return;

  const domainKey = els.taskDomainSelect.value;
  const profile = DOMAIN_DRAFTS[domainKey] || DOMAIN_DRAFTS["biomedical-signal"];
  const type = TYPE_DRAFTS[els.taskType.value] || TYPE_DRAFTS.analysis;
  const standard = STANDARD_DRAFTS[els.taskStandard.value] || STANDARD_DRAFTS.enterprise;
  const scenario = pickScenario();
  const expertise = expertiseLabel(els.taskExpertise.value).toLowerCase();
  const userNotes = cleanSourceNotes(els.taskDomain.value.trim());
  const sourceSentence = userNotes ? ` Use these source notes and constraints: ${userNotes}` : "";

  els.taskDomain.value = `${capitalize(expertise)} ${scenario.name} task in ${profile.domain}.${sourceSentence}`;
  els.taskPrompt.value = scenario.composePrompt(profile, type, standard);
  els.taskResources.value = buildResourceDraft(domainKey, profile, scenario, standard);
  els.taskSolution.value = buildGoldenSolutionDraft(domainKey, profile, scenario);
  els.taskDifficulty.value = `This is ${expertise} difficulty because it requires ${profile.method} in a real ${profile.domain} workflow under a ${scenario.name} scenario. A weak solution can look plausible while still failing due to ${profile.failure}, or by mishandling the scenario-specific requirement to ${scenario.objective}. The difficulty comes from domain constraints, enterprise-grade edge cases, reproducible computation, and verifier-aware output design rather than from arbitrary volume or obscure trivia.`;
  els.taskTime.value = timeEstimateFor(els.taskExpertise.value, profile.domain);
  els.taskVerifiers.value = buildVerifierDraft(domainKey, type, scenario, standard);
  els.taskAgentCheck.value = "Optional: If tested with a terminal-enabled coding tool, record whether failures came from data parsing, domain assumptions, numerical methods, debugging, or verifier interpretation.";

  buildTaskPackage();
}

function buildResourceDraft(domainKey, profile, scenario, standard) {
  const details = DOMAIN_DETAILS[domainKey];
  const domainResources = details ? details.resources : [
    `data/source_inputs.csv derived from ${profile.sourceKit}.`,
    "config/task_config.yaml with thresholds, units, and scenario-specific parameters.",
    "schemas/expected_output.schema.json defining every submitted column or JSON field.",
    "verifier_inputs/normal_case.csv, verifier_inputs/edge_case.csv, verifier_inputs/invalid_case.csv, and expected_metrics.json."
  ];

  return [
    "Provide one self-contained zip folder with this structure:",
    "",
    "Public source references:",
    ...resourceSourcesFor(details, profile).map((item) => `- ${item}`),
    "",
    "README.md",
    "- Describe each file, column schema, unit, coordinate/time convention, expected output path, and exclusion rule.",
    "- State that the workflow must run without network access after the zip is unpacked.",
    "",
    "environment/",
    "- requirements.txt or environment.yml with exact package versions.",
    "- version_manifest.json with Python version, package versions, and any tool versions.",
    "",
    "Source data and task fixtures:",
    ...domainResources.map((item) => `- ${item}`),
    "",
    "Scenario evidence:",
    `- ${scenario.resource}.`,
    "- audit_log_template.csv with fields for input file, checksum, validation status, exclusion reason, output artifact, and rerun timestamp.",
    "",
    "Expected output contract:",
    `- The submitted solution must create ${profile.artifact}.`,
    "- Include schemas for every required output and one example row or object for each artifact.",
    "",
    "Test fixtures:",
    "- Include one normal case, one edge case, and one intentionally invalid case.",
    "- Include expected pass/fail reason codes for the verifier fixtures.",
    "",
    standard.resources
  ].join("\n");
}

function resourceSourcesFor(details, profile) {
  if (details && Array.isArray(details.sources) && details.sources.length) return details.sources;
  return [
    `Source basis: ${profile.sourceKit}.`,
    "README.md must name the exact public dataset, repository, paper, standard, or self-contained benchmark source used for the task."
  ];
}

function buildGoldenSolutionDraft(domainKey, profile, scenario) {
  const details = DOMAIN_DETAILS[domainKey];
  const domainSteps = details ? details.solution : [
    "Implement solve.py with a command such as python solve.py --input data --config config/task_config.yaml --out outputs.",
    "Validate required files, schemas, units, identifiers, and checksums before computing final outputs.",
    `Apply ${profile.method} and record accepted records, rejected records, parameter settings, and intermediate values needed for audit.`,
    `Write ${profile.artifact}, outputs/qc_summary.json, and outputs/run_manifest.json with deterministic ordering.`
  ];

  return [
    "A strong solution would be organized as a reproducible terminal workflow, not a prose-only answer.",
    "",
    ...domainSteps.map((step, index) => `${index + 1}. ${step}`),
    `${domainSteps.length + 1}. Re-run from a clean checkout and confirm that output files, row ordering, checksums, and metrics are identical.`,
    `${domainSteps.length + 2}. Run the verifier fixtures for one normal case, one edge case, and one invalid case; record each pass/fail reason in outputs/qc_summary.json.`,
    "",
    "Required evidence in the golden solution:",
    "- Exact command used to run the workflow.",
    "- Expected output file paths.",
    "- Required output columns or JSON fields.",
    "- Numeric tolerances, thresholds, or schema rules used by the verifier.",
    "- Known failure modes and how the solution detects them.",
    "- Input checksums, rejected-input reasons, and package versions.",
    "",
    `Important edge cases: ${profile.failure}.`
  ].join("\n");
}

function cleanSourceNotes(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const generatedSignals = [
    "generated prompt draft",
    "resources needed to solve the task",
    "golden solution",
    "difficulty explanation",
    "professional time estimate",
    "verifiers description",
    "source notes or constraints",
    "task in computational biology",
    "task in computer science algorithms",
    "task in applied mathematics",
    "task in biomedical signal processing",
    "task in robotics and control",
    "task in machine learning systems"
  ];
  if (hasAny(trimmed, generatedSignals)) return "";
  return trimmed;
}

function buildVerifierDraft(domainKey, type, scenario, standard) {
  const details = DOMAIN_DETAILS[domainKey];
  const domainVerifierChecks = details ? details.verifiers : [
    "Check required output files, exact schemas, row counts, stable ordering, and numeric tolerances.",
    "Fail intentionally invalid fixtures with the expected reason code.",
    "Confirm repeated runs produce identical machine-readable outputs."
  ];

  return [
    `A deterministic verifier should ${type.verifier} and ${scenario.verifier}.`,
    "",
    "Required verifier behavior:",
    ...domainVerifierChecks.map((item) => `- ${item}`),
    "- Assert exact output schema, required files, numeric tolerances, record counts, and reproducibility across repeated runs.",
    "- Fail on missing files, wrong units, invalid identifiers, incorrect filtering, tolerance violations, non-deterministic outputs, or omitted intermediate evidence.",
    `- ${standard.verifier}`
  ].join("\n");
}

function pickScenario() {
  const key = "selection-improvement-scenario-index";
  const current = Number(localStorage.getItem(key) || "-1");
  const next = (current + 1) % SCENARIO_STYLES.length;
  localStorage.setItem(key, String(next));
  return SCENARIO_STYLES[next];
}

function hasTaskDraft() {
  return [
    els.taskDomain,
    els.taskPrompt,
    els.taskResources,
    els.taskSolution,
    els.taskDifficulty,
    els.taskTime,
    els.taskVerifiers,
    els.taskAgentCheck
  ].some((input) => input.value.trim());
}

function taskContentValues(fields) {
  return [fields.domain, fields.prompt, fields.resources, fields.solution, fields.difficulty, fields.time, fields.verifiers, fields.agentCheck];
}

function expertiseLabel(value) {
  const labels = {
    professional: "Senior professional",
    masters: "Master's level",
    phd: "PhD / research level"
  };
  return labels[value] || labels.professional;
}

function timeEstimateFor(expertise, domain) {
  if (expertise === "phd") return `8-16 hours for a PhD-level specialist or research engineer with experience in ${domain}.`;
  if (expertise === "masters") return `5-9 hours for a master's-level practitioner with applied experience in ${domain}.`;
  return `3-6 hours for a senior professional with hands-on experience in ${domain}.`;
}

function capitalize(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

function getTaskFields() {
  return {
    domain: els.taskDomain.value.trim(),
    expertise: els.taskExpertise.value,
    prompt: els.taskPrompt.value.trim(),
    resources: els.taskResources.value.trim(),
    solution: els.taskSolution.value.trim(),
    difficulty: els.taskDifficulty.value.trim(),
    time: els.taskTime.value.trim(),
    verifiers: els.taskVerifiers.value.trim(),
    agentCheck: els.taskAgentCheck.value.trim()
  };
}

function packageText(value, fallback) {
  return value || `[${fallback}]`;
}

function buildSubmissionRubric(fields) {
  const expertise = expertiseLabel(fields.expertise);
  return [
    `Pass only if the submitted prompt is a ${expertise} task grounded in a real professional or academic domain.`,
    "Pass only if the final objective is stated upfront and asks for a concrete output artifact.",
    "Pass only if the task requires terminal/computer work such as code, data analysis, simulation, or tool use.",
    "Pass only if all required resources are named, self-contained, versioned where relevant, and available without hidden access.",
    "Pass only if the golden solution describes a plausible expert solve path with commands, scripts, checks, and expected outputs.",
    "Pass only if the verifier checks explicit output artifacts with deterministic pass/fail logic and tolerances or schemas.",
    "Reject if the task is mainly explanation, opinion, GUI/manual work, methodology checking, obscure trivia, oversized busywork, or an unsolved research problem.",
    "Reject if the difficulty comes from volume or trickiness instead of domain reasoning, implementation complexity, or verifier-aware edge cases.",
    "Reject if two qualified reviewers could reasonably disagree about what a correct final answer should look like."
  ].join("\n");
}

function buildGoldenSolutionRubric(fields) {
  return [
    "The golden solution should pass only if it proves the task is solvable and gives a qualified reviewer enough detail to reproduce the answer.",
    "",
    "Golden solution must include:",
    "- A runnable command or workflow entry point such as solve.py, make, pytest, or a documented shell command.",
    "- Exact expected output paths and file names.",
    "- Required output columns, JSON fields, or schema references.",
    "- The core domain computation steps, not generic phrases like process the data or apply analysis.",
    "- Acceptance thresholds, tolerances, or deterministic comparison rules.",
    "- Normal, edge-case, and invalid-input handling.",
    "- Traceability fields such as input checksums, source record IDs, row counts, rejected records, and package versions.",
    "- A repeatability check from a clean checkout.",
    "",
    "Reject the golden solution if:",
    "- It only says to inspect, analyze, summarize, or validate without naming concrete artifacts.",
    "- It depends on a human or an LLM to decide whether the final answer is correct.",
    "- It checks the method instead of checking the produced output.",
    "- It leaves the correct answer ambiguous or does not define the expected output contract.",
    "- It is mostly boilerplate that could apply to any domain."
  ].join("\n");
}

function getTaskChecks(fields) {
  const allText = Object.values(fields).join(" ");
  const prompt = fields.prompt;
  const resources = fields.resources;
  const solution = fields.solution;
  const verifiers = fields.verifiers;
  const difficulty = fields.difficulty;
  const domain = fields.domain;
  const expertiseText = expertiseLabel(fields.expertise);

  return [
    {
      title: "Final goal upfront",
      pass: prompt.length > 60 && !startsWithProcess(prompt),
      message: "The prompt should begin with the desired output/result, not a long method or step list."
    },
    {
      title: "Focus on goal, not process",
      pass: !hasProcessHeavyLanguage(prompt),
      message: "Avoid prescribing every step or specific tools unless required by the task."
    },
    {
      title: "Concise prompt",
      pass: prompt.length > 0 && prompt.split(/\n\s*\n/).filter(Boolean).length <= 3 && prompt.length <= 1400,
      message: "Keep the task prompt brief enough to fit in one to three focused paragraphs."
    },
    {
      title: "No persona framing",
      pass: !hasAny(prompt, ["you are a scientist", "you are an engineer", "act as", "pretend you are", "roleplay", "as a data scientist"]),
      message: "Avoid persona-based framing; state the task objective directly."
    },
    {
      title: "Computer or terminal required",
      pass: hasAny(allText, ["python", "script", "terminal", "linux", "command", "code", "data", "simulation", "dataset", "file"]),
      message: "The task must require computer use such as code, scripts, data analysis, files, or terminal commands."
    },
    {
      title: "No GUI-only workflow",
      pass: !hasAny(prompt, ["click", "screenshot", "browser only", "spreadsheet manually", "use the gui", "drag and drop"]),
      message: "The task should be answerable through terminal/code/tool usage, not a graphical/manual workflow."
    },
    {
      title: "Not just reasoning",
      pass: !isReasoningOnly(prompt),
      message: "Avoid tasks that only ask for explanation, summary, or opinion without producing a verifiable artifact."
    },
    {
      title: "Real-world source inspiration",
      pass: hasAny(`${domain} ${resources}`, ["public", "dataset", "paper", "standard", "specification", "benchmark", "repository", "research", "industry", "professional", "academic", "case study"]),
      message: "Ground the task in a real public dataset, paper, standard, benchmark, repository, or professional workflow."
    },
    {
      title: "Not toy or classroom-style",
      pass: !hasAny(allText, ["toy example", "simple example", "hello world", "classroom", "homework", "beginner", "basic tutorial", "contrived", "made up data"]),
      message: "Avoid prompts that read like homework, tutorials, toy examples, or made-up data exercises."
    },
    {
      title: "Specific objective output",
      pass: hasAny(prompt, ["return", "produce", "write", "generate", "compute", "create"]) && hasAny(prompt, ["csv", "json", "file", "table", "report", "metric", "score", "plot", "artifact", "output"]),
      message: "The prompt should request a concrete output artifact or measurable result, not broad advice or explanation."
    },
    {
      title: "Output graded, not method",
      pass: !hasAny(prompt, ["must use this exact command", "must use emacs", "must use vim", "must solve by", "must use this method"]) && hasAny(prompt, ["return", "output", "write", "produce", "file", "csv", "json"]),
      message: "Grade the final result, not the exact approach, unless the method itself is the domain requirement."
    },
    {
      title: "Complete environment",
      pass: resources.length > 80 && hasAny(resources, ["dataset", "file", "package", "library", "version", "source", "download", "csv", "json", "python"]),
      message: "List all files, datasets, packages, versions, public sources, and setup artifacts the agent needs."
    },
    {
      title: "Open usable data",
      pass: !hasAny(resources, ["private dataset", "paywalled", "login required", "credentials required", "proprietary", "restricted license", "not publicly available"]),
      message: "Data and resources should be available without usage restrictions, credentials, or hidden access."
    },
    {
      title: "Resource bundle clarity",
      pass: hasAny(resources, ["zip", "folder", "archive", "data/", "README", "schema", "manifest"]) && hasAny(resources, ["version", "package", "library", "environment", "python"]),
      message: "Name the provided files/folders, schema or manifest, package versions, and environment assumptions."
    },
    {
      title: "Named resource files",
      pass: countMatches(resources, /\b[\w/-]+\.(csv|json|jsonl|yaml|yml|md|txt|parquet|sql|py|geojson|gff3|fa|fasta|pcap|log|edn|tla|als)\b/gi) >= 5,
      message: "Name concrete files such as data inputs, configs, schemas, manifests, and verifier fixtures."
    },
    {
      title: "No vague resource placeholders",
      pass: !hasAny(resources, ["realistic source-grounded files", "domain-appropriate", "where relevant", "etc.", "and anything", "some files", "real life examples"]),
      message: "Avoid placeholder resource language that could read as generated or underspecified."
    },
    {
      title: "File size caution",
      pass: !hasAny(resources, ["over 100 mb", ">100mb", "larger than 100 mb", "huge file", "massive file"]),
      message: "Keep individual resources within project upload limits and avoid oversized artifacts."
    },
    {
      title: "Golden solution provided",
      pass: solution.length > 140 && hasAny(solution, ["run", "compute", "check", "output", "script", "command", "compare", "expected"]),
      message: "Provide a granular solve path with commands, scripts, checks, logical steps, and expected output."
    },
    {
      title: "Golden solution has runnable workflow",
      pass: hasAny(solution, ["python solve.py", "pytest", "make", "run.sh", "command"]) && hasAny(solution, ["outputs/", "output path", "expected output"]),
      message: "The golden solution should include a concrete command or entry point and expected output paths."
    },
    {
      title: "Golden solution is verifier-ready",
      pass: hasAny(solution, ["schema", "columns", "json fields", "tolerance", "threshold", "reason code"]) && hasAny(solution, ["normal case", "edge case", "invalid case", "rejected"]),
      message: "The golden solution should state output contract details, tolerances, and normal/edge/invalid case handling."
    },
    {
      title: "Golden solution not boilerplate",
      pass: !hasAny(solution, ["domain inputs", "domain constraints", "as appropriate", "where relevant", "etc.", "realistic", "supporting evidence files"]),
      message: "Avoid generic golden-solution wording that could apply to any task."
    },
    {
      title: "Acceptance criteria clear",
      pass: hasAny(`${prompt} ${verifiers}`, ["exact", "within", "tolerance", "schema", "columns", "rows", "threshold", "must", "required", "pass", "fail"]),
      message: "Make the correct answer unambiguous with explicit schema, tolerance, thresholds, or pass/fail conditions."
    },
    {
      title: "Deterministic verifiers",
      pass: verifiers.length > 100 && hasAny(verifiers, ["assert", "compare", "exact", "tolerance", "checksum", "test", "script", "pass", "fail", "output"]),
      message: "Verifiers should programmatically accept correct outputs and reject incorrect ones."
    },
    {
      title: "No subjective verifier",
      pass: !hasAny(verifiers, ["manual review only", "subjective review", "human judgment only", "qualitative judgment only"]),
      message: "Verifiers must use deterministic checks instead of subjective judgment."
    },
    {
      title: "No methodology-only verifier",
      pass: !hasAny(verifiers, ["check the method", "verify methodology", "must use the same approach", "inspect the code style", "review the reasoning"]),
      message: "Verifiers should check outputs and explicit artifacts, not the solver's chosen methodology."
    },
    {
      title: "No script-as-final-answer trap",
      pass: !hasAny(prompt, ["submit only a script", "return the script only", "final answer is a script"]) || hasAny(verifiers, ["script output", "output file", "generated output", "run the script"]),
      message: "If a script is required, the verifier should test the script output, not treat the script text as the only answer."
    },
    {
      title: "Solvable",
      pass: solution.length > 140 && !hasAny(allText, ["unknown answer", "unsolved research", "impossible"]),
      message: "The task needs a known path to a correct answer and should not be an unsolved research problem."
    },
    {
      title: "Six core criteria covered",
      pass: hasAny(allText, ["verifiable", "well specified", "well-specified"]) && hasAny(allText, ["solvable"]) && hasAny(allText, ["code", "script", "python", "computer"]) && hasAny(allText, ["difficult", "hard", "nontrivial"]) && hasAny(allText, ["domain", "expert", "professional", "academic"]),
      message: "The submission should clearly satisfy verifiable, well-specified, solvable, requires-code, difficult, and domain-expertise criteria."
    },
    {
      title: "Genuinely difficult",
      pass: difficulty.length > 120 && hasAny(difficulty, ["expert", "domain", "automated", "model", "nontrivial", "professional", "hard", "failure"]),
      message: "Explain why the task is hard because of domain reasoning or implementation, not arbitrary volume or obscure trivia."
    },
    {
      title: "Difficulty is not artificial",
      pass: !hasAny(difficulty, ["lots of files", "large volume", "many pages", "obscure trivia", "trick question", "adversarial wording", "tedious only", "takes a long time"]),
      message: "Difficulty should come from domain reasoning, implementation, or verification complexity, not volume, tricks, or obscurity."
    },
    {
      title: "Domain expertise",
      pass: domain.length > 50 && hasAny(`${domain} ${difficulty}`, ["professional", "academic", "expert", "domain", "engineering", "scientific", "research"]),
      message: "Tie the task to a professional or academic domain where expertise matters."
    },
    {
      title: `${expertiseText} depth`,
      pass: hasExpertiseDepth(fields),
      message: "Include specialized methods, domain constraints, and failure modes that match the selected expertise level."
    },
    {
      title: "Specialized method required",
      pass: hasAny(allText, ["statistical", "optimization", "simulation", "numerical", "algorithm", "calibration", "inference", "regression", "validation", "signal", "time series", "time-series", "geospatial", "bioinformatics", "finite element", "bayesian", "stochastic"]),
      message: "A strong prompt should require a nontrivial technical method, not generic summarization or simple lookup."
    },
    {
      title: "Time estimate",
      pass: fields.time.length > 20 && /\d/.test(fields.time),
      message: "Give a realistic estimate for a qualified professional, including relevant experience level."
    },
    {
      title: "Prompt draft present",
      pass: prompt.length > 0,
      message: "Enter the actual prompt, then use this app to check and format it against the guidelines."
    }
  ];
}

function startsWithProcess(text) {
  return /^\s*(first|step\s*1|start by|begin by|use|run|open|install|write a script)/i.test(text);
}

function hasProcessHeavyLanguage(text) {
  const processSignals = (text.match(/\b(first|then|next|after that|finally|step|run this|use this command|install|open)\b/gi) || []).length;
  return processSignals >= 6;
}

function isReasoningOnly(text) {
  const normalized = normalize(text);
  const reasoningVerbs = ["explain", "summarize", "discuss", "describe", "argue", "compare and contrast", "write an essay"];
  const artifactTerms = ["csv", "json", "file", "script", "code", "table", "metric", "report", "output", "artifact", "plot", "dataset"];
  return reasoningVerbs.some((term) => normalized.includes(normalize(term))) && !artifactTerms.some((term) => normalized.includes(normalize(term)));
}

function hasAny(text, terms) {
  const normalized = normalize(text);
  return terms.some((term) => normalized.includes(normalize(term)));
}

function countMatches(text, regex) {
  return (String(text || "").match(regex) || []).length;
}

function hasExpertiseDepth(fields) {
  const text = normalize(`${fields.domain} ${fields.prompt} ${fields.solution} ${fields.difficulty} ${fields.verifiers}`);
  const professionalTerms = ["professional", "industry", "engineering", "validation", "edge case", "tolerance", "quality", "standard"];
  const mastersTerms = ["statistical", "algorithm", "optimization", "simulation", "validation", "nontrivial", "baseline", "tolerance", "regression", "inference"];
  const phdTerms = ["research", "paper", "methodology", "bayesian", "stochastic", "asymptotic", "causal", "finite element", "peer reviewed", "ablation", "theorem"];
  const terms = fields.expertise === "phd" ? phdTerms : fields.expertise === "masters" ? mastersTerms : professionalTerms;
  const hits = terms.filter((term) => text.includes(normalize(term))).length;
  return fields.expertise === "professional" ? hits >= 2 : hits >= 3;
}

function renderTaskChecks(fields) {
  const checks = getTaskChecks(fields);
  els.taskChecks.innerHTML = "";
  checks.forEach((check) => {
    const item = document.createElement("div");
    item.className = `check-item ${check.pass ? "pass" : "warn"}`;
    item.innerHTML = `<strong>${check.pass ? "PASS" : "NEEDS WORK"} - ${escapeHtml(check.title)}</strong>${escapeHtml(check.message)}`;
    els.taskChecks.appendChild(item);
  });
}

async function copyTaskPackage() {
  if (!els.generatedTaskPackage.value.trim()) buildTaskPackage();
  try {
    await navigator.clipboard.writeText(els.generatedTaskPackage.value);
    els.copyTaskPackage.textContent = "Copied";
    setTimeout(() => {
      els.copyTaskPackage.textContent = "Copy";
    }, 1200);
  } catch {
    els.generatedTaskPackage.select();
    document.execCommand("copy");
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify({ guides: state.guides }, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "selection-improvement-experts-data.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      state.guides = Array.isArray(imported.guides) ? imported.guides : state.guides;
      save();
      renderAll();
    } catch {
      alert("That file could not be imported.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function clearData() {
  if (!confirm("Clear all saved guidelines?")) return;
  state.guides = [];
  save();
  renderAll();
}

function loadSampleData() {
  const sample = {
    id: uid(),
    title: "Visible Selection Improvement Expert Rubric",
    tags: "worker submission, task design, terminal, verifiers, quality criteria",
    body: `Tasks must require a computer to be answered, such as data analysis, numerical simulation, code, files, terminal commands, or tool usage.
Prompts must be answerable using a Linux terminal, for example with Python scripts or tool usage.
Do not make GUI-only workflows.
Do not make just-reasoning questions.
Tasks must involve actual computation, coding, or tool use.
Agents should be evaluated as workflow performers, not just answer generators.
Strong tasks require the agent to understand the goal, choose an approach, execute commands, inspect results, and revise when something fails.
Tasks should force meaningful iteration.
Tasks should be difficult, real-world, verifiable professional tasks in your domain.
Most successful tasks use prior professional or academic projects as inspiration.
All data required for the task must be available from sources without usage restrictions.
Tasks must have objective, verifiable answers with well-specified output formats.
Tasks should take a long time for a professional in the field to perform.
State the final goal upfront. The best instructions are brief, with the objective stated clearly in the first sentences.
Focus on the goal, not the process. Do not enumerate every step or prescribe specific tools.
Keep it concise. The best tasks can be described in one to three paragraphs.
Avoid persona-based framing.
Do not include sentences that will not be used for solving the problem.
Leave nothing ambiguous. Every acceptance criterion that the verifier will check must be stated or clearly inferable.
Ensure the task is outcome-verified. Grade the final result, not the approach taken.
Do not force a specific tool or command unless the method itself is part of the domain requirement.
Assume a complete environment. Reference the environment, files, and tools that will be available to the agent.
Resources must list all databases, public datasets, open-source packages, configuration files, simulation inputs, container images, custom scripts, pre-built binaries, and setup details needed to solve the task.
Name every artifact and describe what it contains.
Include version numbers for packages and tools.
Upload resources as zip files when needed.
Individual resource files must stay within project upload limits.
Provide a golden solution as granular as possible, including code, scripts, commands, or logical steps an expert would execute.
Resources must include all datasets, public data, packages, configuration files, scripts, container images, binaries, versions, and setup details needed to solve the task.
The golden solution should be implementable by someone who knows exactly what to do in a few hours at most.
Difficulty explanation must explain why the task is beyond common automated approaches, why domain expertise is required, and why the difficulty is genuine rather than arbitrary.
Difficulty should not come from high compute requirements, large tedious volumes, obscure trivia, adversarial tricks, or an unknown/open-ended answer.
Optional agent difficulty checks are supporting evidence only and do not replace the formal difficulty validation.
Professional time estimates should be realistic for a qualified professional and scoped down if work volume, rather than intellectual difficulty, makes it too long.
Verifiers must be deterministic, efficient, reliable, and based on explicit output.
Verifiers must not rely on subjective judgment.
Verifiers must pass a correct solution and reject an incorrect one.
Simple verifiers are often better than elaborate ones.
Verifiers should be based on explicit output files and artifacts, not hidden conversation or subjective interpretation.
Types of checks to consider include logic and accuracy, technical compliance, regressions and quality, and performance or parity.
Invalid verifier examples include methodology checks, algebraic expression equivalence that can be written many ways, and checking a required final script instead of the script output.
Every task proposal is evaluated against six core criteria and must satisfy all six to be accepted.
The task must be verifiable, well-specified, solvable, require code or computer use, difficult, and domain-expertise driven.`
  };

  state.guides.unshift(sample);
  save();
  renderAll();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function renderAll() {
  renderGuideList();
}

els.tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
els.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderGuideList();
});
els.guideForm.addEventListener("submit", saveGuide);
els.resetForm.addEventListener("click", resetForm);
els.analyzeQuestion.addEventListener("click", analyzeQuestion);
els.fillStarterTemplate.addEventListener("click", fillStarterTemplate);
els.buildTaskPackage.addEventListener("click", buildTaskPackage);
els.copyTaskPackage.addEventListener("click", copyTaskPackage);
els.exportData.addEventListener("click", exportData);
els.importData.addEventListener("change", importData);
els.clearData.addEventListener("click", clearData);
els.sampleData.addEventListener("click", loadSampleData);

load();
renderAll();
renderTaskChecks(getTaskFields());
