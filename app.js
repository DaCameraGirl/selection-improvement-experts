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
    "",
    "Project fit",
    packageText(fields.domain, "Describe the real-world professional domain, source inspiration, and why the task requires domain expertise."),
    "",
    "Expertise level target",
    expertiseLabel(fields.expertise),
    "",
    "Prompt",
    packageText(fields.prompt, "Write the exact prompt that will be provided to the agent."),
    "",
    "Resources needed to solve the task",
    packageText(fields.resources, "List every dataset, file, package, public source, version, and setup artifact the agent needs."),
    "",
    "Golden solution - as granular as possible",
    packageText(fields.solution, "Provide the solve path, including commands, code/scripts, checks, and expected outputs."),
    "",
    "Difficulty explanation",
    packageText(fields.difficulty, "Explain why this is hard, why common automated approaches may fail, and why it requires domain expertise."),
    "",
    "Professional time estimate",
    packageText(fields.time, "Estimate how long a qualified professional would need."),
    "",
    "Verifiers description",
    packageText(fields.verifiers, "Describe deterministic checks that accept correct outputs and reject incorrect outputs."),
    "",
    "Optional agent difficulty check",
    packageText(fields.agentCheck, "Summarize terminal-agent testing only if you performed it."),
    "",
    "Built-in guideline checklist",
    getTaskChecks(fields).map((check) => `${check.pass ? "PASS" : "NEEDS WORK"} - ${check.title}: ${check.message}`).join("\n")
  ].join("\n");
}

const DOMAIN_DRAFTS = {
  "biomedical-signal": {
    domain: "biomedical signal processing using public ECG or PPG waveform data, clinical signal-quality constraints, and reproducible Python analysis",
    artifact: "a CSV report and validation plot",
    method: "wavelet denoising, notch filtering, peak detection, beat-level feature extraction, and tolerance-based validation against reference annotations",
    data: "MIT-BIH-style waveform segments, annotation files, sampling-rate metadata, and a channel manifest",
    failure: "filter leakage, incorrect sampling-rate conversion, false peak matching, and accepting visually plausible but clinically invalid beat intervals"
  },
  "climate-geospatial": {
    domain: "climate and geospatial analytics using station observations, raster grids, coordinate transforms, and reproducible regional aggregation",
    artifact: "a GeoJSON layer and a CSV anomaly table",
    method: "spatial joins, CRS normalization, temporal baseline construction, raster sampling, and uncertainty-aware regional aggregation",
    data: "station CSV files, a region boundary GeoJSON, gridded NetCDF or GeoTIFF data, and metadata describing units and coordinate reference systems",
    failure: "mixing coordinate systems, leaking target-period values into baselines, mishandling missing stations, and producing maps that cannot be verified numerically"
  },
  "computational-biology": {
    domain: "computational biology using sequence data, public gene annotations, reproducible alignment-derived features, and biologically meaningful constraints",
    artifact: "a ranked TSV of candidate loci and a machine-readable QC summary",
    method: "sequence parsing, motif scanning, multiple-testing correction, genomic interval joins, and reference-based validation",
    data: "FASTA sequences, GFF/GTF annotations, sample metadata, and a known reference motif table",
    failure: "off-by-one genomic coordinates, strand errors, invalid multiple-testing correction, and biologically implausible candidates"
  },
  "quant-finance": {
    domain: "quantitative finance using market microstructure data, corporate-action adjustments, and reproducible risk metric computation",
    artifact: "a portfolio risk report in CSV and JSON",
    method: "return normalization, volatility estimation, drawdown analysis, factor exposure regression, and out-of-sample validation",
    data: "OHLCV price files, corporate-action tables, factor-return files, and a portfolio holdings file",
    failure: "look-ahead bias, unadjusted splits, incorrect annualization, unstable regression windows, and unverifiable prose-only risk conclusions"
  },
  "materials-science": {
    domain: "materials science using crystallographic structure files, composition descriptors, and reproducible property-screening logic",
    artifact: "a ranked materials table and structure-level validation summary",
    method: "CIF parsing, stoichiometry checks, descriptor generation, symmetry-aware filtering, and threshold-based property ranking",
    data: "CIF files, a composition metadata CSV, reference property measurements, and package/version notes for pymatgen or ASE",
    failure: "invalid oxidation-state assumptions, duplicate structures, unit mistakes, and rankings that ignore crystal symmetry constraints"
  },
  "power-systems": {
    domain: "power systems engineering using load-flow cases, bus/branch tables, generator constraints, and reproducible contingency analysis",
    artifact: "a contingency ranking CSV and voltage-violation report",
    method: "AC or DC load-flow computation, N-1 contingency screening, constraint checking, and tolerance-based comparison to reference cases",
    data: "bus, branch, generator, and load tables plus base-MVA metadata and solver package versions",
    failure: "per-unit conversion errors, slack-bus mishandling, ignored thermal limits, and non-reproducible solver settings"
  },
  "cyber-forensics": {
    domain: "cybersecurity forensics using packet captures, endpoint logs, file hashes, and reproducible incident-timeline reconstruction",
    artifact: "a JSON incident timeline and IOC table",
    method: "PCAP parsing, timestamp normalization, session reconstruction, hash matching, and rule-based event correlation",
    data: "PCAP files, endpoint event logs, hash allow/block lists, and schema documentation for event fields",
    failure: "timezone drift, conflating benign retries with compromise, missing correlated events, and relying on screenshots instead of parsed evidence"
  },
  "robotics-control": {
    domain: "robotics and control using trajectory logs, actuator limits, controller parameters, and reproducible stability or tracking analysis",
    artifact: "a metrics JSON file and trajectory-error CSV",
    method: "state-estimation checks, controller-response simulation, tracking-error computation, and constraint violation detection",
    data: "trajectory logs, robot parameter YAML, reference path files, and controller configuration files",
    failure: "frame-transform mistakes, unstable discretization, hidden actuator-limit violations, and metrics that reward smooth but inaccurate paths"
  },
  econometrics: {
    domain: "econometrics and policy analysis using panel data, treatment timing, fixed effects, and reproducible robustness checks",
    artifact: "a regression summary CSV and robustness-check JSON",
    method: "panel cleaning, difference-in-differences estimation, clustered standard errors, placebo tests, and pre-trend diagnostics",
    data: "panel outcome data, treatment timing tables, covariate files, and a data dictionary",
    failure: "bad treatment timing, wrong fixed effects, unclustered errors, post-treatment controls, and conclusions not tied to computed estimates"
  },
  "computational-linguistics": {
    domain: "computational linguistics using annotated corpora, morphology or syntax labels, and reproducible corpus-level evaluation",
    artifact: "an error-analysis table and metrics JSON",
    method: "corpus parsing, stratified metric computation, agreement analysis, tokenization checks, and label-level confusion analysis",
    data: "annotated text files, label schema documentation, train/test split manifests, and tokenizer version notes",
    failure: "label leakage, token-boundary drift, invalid averaging, and unsupported linguistic conclusions"
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

function fillStarterTemplate() {
  const confirmed = hasTaskDraft() ? confirm("Replace the current draft with a generated domain draft?") : true;
  if (!confirmed) return;

  const profile = DOMAIN_DRAFTS[els.taskDomainSelect.value] || DOMAIN_DRAFTS["biomedical-signal"];
  const type = TYPE_DRAFTS[els.taskType.value] || TYPE_DRAFTS.analysis;
  const expertise = expertiseLabel(els.taskExpertise.value).toLowerCase();
  const userNotes = els.taskDomain.value.trim();
  const sourceSentence = userNotes ? ` Use these source notes and constraints: ${userNotes}` : "";

  els.taskDomain.value = `${capitalize(expertise)} task in ${profile.domain}.${sourceSentence}`;
  els.taskPrompt.value = `${type.verb} ${type.focus} for ${profile.domain}. Return ${profile.artifact} that can be checked without interpretation. The result must use the provided resources, apply the required domain constraints, and expose enough intermediate fields for verification.`;
  els.taskResources.value = `Provide a self-contained zip folder with ${profile.data}. Include a README describing file schemas, units, coordinate systems or sampling rates where relevant, package versions, and the expected output paths. The environment should include Python 3.11 plus domain-appropriate open-source packages, and no network access should be needed after the resources are supplied.`;
  els.taskSolution.value = `Create a reproducible script such as solve.py. Load and validate the provided files, normalize units and identifiers, apply ${profile.method}, write the required output artifact, and emit a small QC summary with row counts, rejected records, parameter settings, and final metrics. Re-run the script from a clean directory and confirm that the same outputs are produced.`;
  els.taskDifficulty.value = `This is ${expertise} difficulty because it requires ${profile.method} in a real ${profile.domain} workflow. A weak solution can look plausible while still failing due to ${profile.failure}. The difficulty comes from domain constraints, edge cases, reproducible computation, and verifier-aware output design rather than from arbitrary volume or obscure trivia.`;
  els.taskTime.value = timeEstimateFor(els.taskExpertise.value, profile.domain);
  els.taskVerifiers.value = `A deterministic verifier should ${type.verifier}. It should assert exact output schema, required files, numeric tolerances, record counts, domain-specific constraints, and reproducibility across repeated runs. It should fail on missing files, wrong units, invalid identifiers, incorrect filtering, tolerance violations, non-deterministic outputs, and outputs that omit required intermediate evidence.`;
  els.taskAgentCheck.value = "Optional: If tested with a terminal-enabled coding tool, record whether failures came from data parsing, domain assumptions, numerical methods, debugging, or verifier interpretation.";

  buildTaskPackage();
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
