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
    els.generatedTaskPackage.value = "Use Load Example or enter your own task details, then click Build Package.";
    return;
  }

  els.generatedTaskPackage.value = [
    "Selection Improvement Expert Task Package",
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

function fillStarterTemplate() {
  const confirmed = hasTaskDraft() ? confirm("Replace the current draft with the example? Do not submit the example as your own prompt.") : true;
  if (!confirmed) return;

  els.taskDomain.value = "EXAMPLE ONLY - A professional environmental data-analysis task inspired by public NOAA weather station data. The task requires time-series cleaning, anomaly detection, statistical comparison, and reproducible Python output, which makes it appropriate for a terminal-enabled agent rather than a regular chatbot.";
  els.taskExpertise.value = "masters";
  els.taskPrompt.value = "Compute a station-level anomaly report that identifies the three NOAA stations with the largest positive deviation in daily maximum temperature relative to their own 30-day rolling baseline, and return a CSV with station_id, date, observed_tmax_c, baseline_tmax_c, anomaly_c, and rank. The answer must be based on the provided CSV files and must include only rows that pass the data-quality constraints described in the resources.";
  els.taskResources.value = "Provide a zip folder containing data/stations.csv and data/daily_observations.csv. stations.csv includes station_id, latitude, longitude, elevation_m, and region. daily_observations.csv includes station_id, date, tmax_c, tmin_c, precipitation_mm, and quality_flag. The environment includes Python 3.11, pandas 2.2.x, numpy 1.26.x, and pytest 8.x. All data needed for the task is in the zip folder; no network access is required.";
  els.taskSolution.value = "Create a Python script such as solve.py. Load both CSV files with pandas, parse date as datetime, keep only rows where quality_flag equals OK, drop rows with missing tmax_c, sort by station_id and date, compute each station's 30-day rolling mean of tmax_c using prior days only, calculate anomaly_c as observed tmax_c minus baseline_tmax_c, select the largest anomaly per station, rank stations by anomaly_c descending, and write the top three rows to output/anomaly_report.csv. Check that the CSV has exactly the required columns, exactly three rows, numeric values rounded to two decimals, and ranks 1 through 3.";
  els.taskDifficulty.value = "This is genuinely difficult because the agent must reason about leakage-free rolling baselines, grouped time-series operations, data-quality filtering, deterministic output formatting, and edge cases such as missing observations or stations with insufficient history. A common automated solution can easily produce plausible code that uses the current day in the baseline, forgets quality filtering, ranks individual rows instead of station-level maxima, or returns non-reproducible prose instead of the required CSV. A data scientist or environmental analyst would recognize these failure modes and verify the output.";
  els.taskTime.value = "3-5 hours for a professional data scientist with time-series data-cleaning experience.";
  els.taskVerifiers.value = "A pytest verifier loads output/anomaly_report.csv and compares it against a hidden reference generated from the same input data. It asserts the exact column names and order, exactly three rows, unique station_id values, ranks 1 through 3, all quality_flag constraints applied, no current-day leakage in the rolling baseline, and anomaly_c values within 0.01 of the reference. The verifier fails if the file is missing, extra columns are present, rows are unranked, nonnumeric values appear, or the wrong stations/dates are selected.";
  els.taskAgentCheck.value = "Optional: If tested with a terminal-enabled coding agent, record whether it produced the CSV, whether verifier failures came from rolling-window leakage, filtering mistakes, ranking mistakes, or output-format errors.";

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
      title: "Computer or terminal required",
      pass: hasAny(allText, ["python", "script", "terminal", "linux", "command", "code", "data", "simulation", "dataset", "file"]),
      message: "The task must require computer use such as code, scripts, data analysis, files, or terminal commands."
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
      title: "Complete environment",
      pass: resources.length > 80 && hasAny(resources, ["dataset", "file", "package", "library", "version", "source", "download", "csv", "json", "python"]),
      message: "List all files, datasets, packages, versions, public sources, and setup artifacts the agent needs."
    },
    {
      title: "Golden solution provided",
      pass: solution.length > 140 && hasAny(solution, ["run", "compute", "check", "output", "script", "command", "compare", "expected"]),
      message: "Provide a granular solve path with commands, scripts, checks, logical steps, and expected output."
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
      title: "Solvable",
      pass: solution.length > 140 && !hasAny(allText, ["unknown answer", "unsolved research", "impossible"]),
      message: "The task needs a known path to a correct answer and should not be an unsolved research problem."
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
    title: "Selection Improvement Expert Core Rules",
    tags: "task design, terminal, verifiers, quality criteria",
    body: `Tasks must require a computer to be answered, such as data analysis, numerical simulation, code, files, terminal commands, or tool usage.
Prompts must be answerable using a Linux terminal, for example with Python scripts or tool usage.
State the final goal upfront. The best instructions are brief, with the objective stated clearly in the first sentences.
Focus on the goal, not the process. Do not enumerate every step or prescribe specific tools.
Keep it concise. The best tasks can be described in one to three paragraphs.
Leave nothing ambiguous. Every acceptance criterion that the verifier will check must be stated or clearly inferable.
Ensure the task is outcome-verified. Grade the final result, not the approach taken.
Assume a complete environment. Reference the environment, files, and tools that will be available to the agent.
Provide a golden solution as granular as possible, including code, scripts, commands, or logical steps an expert would execute.
Resources must include all datasets, public data, packages, configuration files, scripts, container images, binaries, versions, and setup details needed to solve the task.
Difficulty explanation must explain why the task is beyond common automated approaches, why domain expertise is required, and why the difficulty is genuine rather than arbitrary.
Verifiers must be deterministic, efficient, reliable, and based on explicit output.
Verifiers must not rely on subjective judgment.
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
