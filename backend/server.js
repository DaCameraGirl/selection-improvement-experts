const express = require("express");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const cors = require("./lib/cors");
const multer = require("multer");
const AdmZip = require("adm-zip");

const PORT = 8787;
const HOST = "127.0.0.1";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const RUN_TIMEOUT_MS = 5 * 60 * 1000;      // 5 min per run step
const WORKSPACES_DIR = path.join(__dirname, "workspaces");

const app = express();
app.use(cors);
app.use(express.json());

// ── In-memory stores (local-only, ephemeral) ──────────────────────────
const packages = new Map();
const runs = new Map();

// ── Synchronous runtime detection at startup ──────────────────────────
function detectRuntimesSync() {
  const checks = [
    { name: "python", cmd: "python", args: ["--version"] },
    { name: "node",   cmd: "node",   args: ["--version"] },
    { name: "git",    cmd: "git",    args: ["--version"] },
  ];
  const results = {};
  for (const check of checks) {
    const result = spawnSync(check.cmd, check.args, {
      encoding: "utf8",
      timeout: 5000,
      shell: false,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    results[check.name] = result.error || result.status !== 0 ? null : output || null;
  }
  return results;
}

const RUNTIMES = detectRuntimesSync();

// ── Helpers ───────────────────────────────────────────────────────────
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ── Multer (memory storage — buffer only, write ourselves) ────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".zip")) {
      cb(new Error("Only .zip files accepted"));
      return;
    }
    cb(null, true);
  }
});

// ── Safe zip extraction (reject zip-slip) ────────────────────────────
function extractZipSafe(zipBuffer, targetDir) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const extracted = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    // Normalise path and reject traversal
    const rawName = entry.entryName;
    const normalised = path.normalize(rawName).replace(/\\/g, "/");
    if (normalised.startsWith("..") || normalised.includes("../") || normalised.includes("..\\")) {
      throw new Error(`Zip-slip detected: ${rawName}`);
    }

    const dest = path.join(targetDir, normalised);
    // Ensure the dest is within targetDir (belt-and-suspenders)
    const resolved = path.resolve(dest);
    if (!resolved.startsWith(path.resolve(targetDir))) {
      throw new Error(`Zip-slip detected: ${rawName} resolves outside workspace`);
    }

    ensureDir(path.dirname(resolved));
    const buf = entry.getData();
    fs.writeFileSync(resolved, buf);
    extracted.push(normalised);
  }

  return extracted;
}

// ── Task family detection ─────────────────────────────────────────────
const FAMILY_RULES = [
  {
    name: "react",
    required: ["src/DataFetcher.tsx", "src/DataFetcher.test.tsx", "jest.config.js", "package.json"],
    optional: ["solve.py", "verify.py", "tsconfig.json"]
  },
  {
    name: "typescript",
    required: ["tsconfig.strict.json", "tsconfig.negative.json", "type_tests/contracts/public_types.md"],
    optional: ["solve.py", "verify.py", "package.json"]
  },
  {
    name: "git",
    required: ["repo_before_force.bundle", "repo_after_force.bundle", "reflog_export.txt"],
    optional: ["solve.py", "verify.py", "commit_graph_spec.json"]
  }
];

function detectTaskFamily(extractedFiles) {
  const fileSet = new Set(extractedFiles);
  const results = [];

  for (const rule of FAMILY_RULES) {
    const missing = rule.required.filter(f => {
      // Check both exact and prefix (for files inside subdirs)
      return !fileSet.has(f) && !extractedFiles.some(ef => ef === f || ef.startsWith(f + "/") || ef.startsWith(f.replace("/", "\\") + "\\"));
    });
    const found = rule.required.filter(f =>
      fileSet.has(f) || extractedFiles.some(ef => ef === f || ef.startsWith(f + "/") || ef.startsWith(f.replace("/", "\\") + "\\"))
    );

    // For directories in required (type_tests/contracts/public_types.md), check if any entry starts with the dir
    const hasTypeTestsDir = extractedFiles.some(ef => ef.startsWith("type_tests/"));
    const typeTestsAdjusted = [...rule.required];
    if (typeTestsAdjusted.includes("type_tests/contracts/public_types.md") && hasTypeTestsDir) {
      const mdIdx = typeTestsAdjusted.indexOf("type_tests/contracts/public_types.md");
      if (!extractedFiles.includes("type_tests/contracts/public_types.md") && extractedFiles.some(ef => ef.startsWith("type_tests/contracts/"))) {
        // Found some contract files — relax the exact match
        typeTestsAdjusted[mdIdx] = null;
      }
    }

    const effectiveRequired = typeTestsAdjusted.filter(Boolean);

    // Recalculate found/missing with adjusted list
    const adjustedFound = effectiveRequired.filter(f =>
      fileSet.has(f) || extractedFiles.some(ef => ef === f || ef.startsWith(f + "/") || ef.startsWith(f.replace("/", "\\") + "\\"))
    );
    const adjustedMissing = effectiveRequired.filter(f =>
      !fileSet.has(f) && !extractedFiles.some(ef => ef === f || ef.startsWith(f + "/") || ef.startsWith(f.replace("/", "\\") + "\\"))
    );

    results.push({
      family: rule.name,
      required: effectiveRequired,
      found: adjustedFound,
      missing: adjustedMissing,
      detected: adjustedMissing.length === 0,
      optional: rule.optional.filter(f => fileSet.has(f) || extractedFiles.some(ef => ef === f))
    });
  }

  // Return first fully detected family
  const detected = results.find(r => r.detected);
  if (detected) return detected;

  // Return the closest match (fewest missing)
  results.sort((a, b) => a.missing.length - b.missing.length);
  return results[0];
}

// ── Health ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "selection-improvement-runner",
    version: "2026-05-12-local-runner",
    python: RUNTIMES.python || "not found",
    node: RUNTIMES.node || "not found",
    git: RUNTIMES.git || "not found"
  });
});

// ── Upload package ─────────────────────────────────────────────────────
app.post("/api/packages", upload.single("package"), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, error: "No file uploaded" });
      return;
    }

    if (req.file.size === 0) {
      res.status(400).json({ ok: false, error: "Empty zip file" });
      return;
    }

    const packageId = "pkg_" + uid();
    const workspace = path.join(WORKSPACES_DIR, packageId);
    ensureDir(workspace);

    // Extract safely
    let extracted;
    try {
      extracted = extractZipSafe(req.file.buffer, workspace);
    } catch (zipErr) {
      // Clean up workspace on extraction failure
      fs.rmSync(workspace, { recursive: true, force: true });
      res.status(400).json({ ok: false, error: `Extraction failed: ${zipErr.message}` });
      return;
    }

    // Detect task family
    const detection = detectTaskFamily(extracted);

    const pkg = {
      packageId,
      workspace,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      extractedFiles: extracted,
      extractedCount: extracted.length,
      family: detection.family,
      familyDetected: detection.detected,
      familyRequired: detection.required,
      familyFound: detection.found,
      familyMissing: detection.missing,
      familyOptional: detection.optional
    };
    packages.set(packageId, pkg);

    res.status(201).json({
      ok: true,
      package_id: packageId,
      workspace,
      detected_family: detection.detected ? detection.family : null,
      closest_family: detection.family,
      required_inputs_found: detection.detected,
      found_files: detection.found,
      missing_inputs: detection.missing,
      extracted_count: extracted.length
    });
  } catch (err) {
    console.error("[runner] upload error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Domain adapter commands ────────────────────────────────────────────
function getSolveCommand(family, workspace) {
  switch (family) {
    case "react":
      return {
        cmd: "python",
        args: ["solve.py", "--repo", ".", "--out", "outputs"],
        cwd: workspace
      };
    case "typescript":
      return {
        cmd: "python",
        args: ["solve.py", "--repo", ".", "--fixtures", "type_tests", "--contracts", "contracts/public_types.md", "--out", "outputs"],
        cwd: workspace
      };
    case "git":
      return {
        cmd: "python",
        args: ["solve.py", "--before", "repo_before_force.bundle", "--after", "repo_after_force.bundle", "--reflog", "reflog_export.txt", "--spec", "commit_graph_spec.json", "--out", "outputs"],
        cwd: workspace
      };
    default:
      return {
        cmd: "python",
        args: ["solve.py", "--out", "outputs"],
        cwd: workspace
      };
  }
}

// ── Subprocess execution (promise-wrapped spawn, no shell:true) ──────
function runStep(command, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Give it a moment then SIGKILL
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
    }, timeoutMs || RUN_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout.push(chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr.push(chunk.toString()); });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code !== null ? code : (timedOut ? -1 : null),
        signal: timedOut ? "SIGTERM" : null,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        timedOut
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: null,
        signal: null,
        stdout: stdout.join(""),
        stderr: stderr.join("") + `\n[spawn error: ${err.message}]`,
        timedOut: false
      });
    });
  });
}

// ── Run an execution step, log results ────────────────────────────────
async function executePipelineStep(run, stepName, command, args, cwd, timeoutMs) {
  run.status = stepName === "setup" ? "SETUP_RUNNING"
    : stepName === "solve" ? "SOLVE_RUNNING"
    : "VERIFY_RUNNING";

  const result = await runStep(command, args, cwd, timeoutMs);
  run.logs[`${stepName}_stdout`] = result.stdout;
  run.logs[`${stepName}_stderr`] = result.stderr;

  if (result.timedOut) {
    run.errors.push(`${stepName} timed out after ${(timeoutMs || RUN_TIMEOUT_MS) / 1000}s`);
    run.status = stepName === "setup" ? "SETUP_FAILED"
      : stepName === "solve" ? "SOLVE_FAILED"
      : "VERIFY_FAILED";
    return false;
  }

  if (result.code !== 0 && result.code !== null) {
    run.errors.push(`${stepName} exited with code ${result.code}`);
    run.status = stepName === "setup" ? "SETUP_FAILED"
      : stepName === "solve" ? "SOLVE_FAILED"
      : "VERIFY_FAILED";
    return false;
  }

  return true;
}

// ── Create a run ──────────────────────────────────────────────────────
async function createRun(packageId, options) {
  const runId = "run_" + uid();
  const pkg = packages.get(packageId);
  if (!pkg) return { error: "Package not found" };

  // Create run directory (copy of package workspace)
  const runDir = path.join(WORKSPACES_DIR, runId);
  ensureDir(runDir);

  // Copy files from package workspace to run directory
  try {
    const entries = fs.readdirSync(pkg.workspace, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(pkg.workspace, entry.name);
      const dst = path.join(runDir, entry.name);
      if (entry.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true });
      } else {
        fs.copyFileSync(src, dst);
      }
    }
  } catch (copyErr) {
    return { error: `Failed to copy workspace: ${copyErr.message}` };
  }

  const run = {
    runId,
    packageId,
    workspace: runDir,
    family: pkg.family,
    status: "NOT_RUN",
    logs: {
      setup_stdout: "", setup_stderr: "",
      solve_stdout: "", solve_stderr: "",
      verify_stdout: "", verify_stderr: ""
    },
    errors: [],
    solveRan: false,
    verifyRan: false,
    verifyPassed: false,
    outputsExist: false
  };

  runs.set(runId, run);

  // Execute steps asynchronously
  run.status = "PACKAGE_UPLOADED";

  // Step 1: Setup (npm ci if package.json exists)
  if (options.run_setup !== false) {
    const hasPackageLock = fs.existsSync(path.join(runDir, "package-lock.json")) ||
                           fs.existsSync(path.join(runDir, "yarn.lock"));
    if (hasPackageLock) {
      const ok = await executePipelineStep(run, "setup", "npm", ["ci", "--no-audit", "--no-fund"], runDir, 120000);
      if (!ok) return run;
    } else {
      run.logs.setup_stdout = "[runner] No package-lock.json found — skipping npm ci";
    }
  }

  // Step 2: Solve
  if (options.run_solve !== false) {
    const solveCmd = getSolveCommand(pkg.family, runDir);
    // Check solve.py exists
    if (!fs.existsSync(path.join(runDir, "solve.py"))) {
      run.errors.push("solve.py not found in package");
      run.status = "SOLVE_FAILED";
      return run;
    }
    const ok = await executePipelineStep(run, "solve", solveCmd.cmd, solveCmd.args, solveCmd.cwd, RUN_TIMEOUT_MS);
    if (!ok) return run;
    run.solveRan = true;

    // Collect outputs
    const outputsDir = path.join(runDir, "outputs");
    if (fs.existsSync(outputsDir)) {
      run.outputsExist = true;
    }
  }

  // Step 3: Verify
  if (options.run_verify !== false) {
    if (!fs.existsSync(path.join(runDir, "verify.py"))) {
      run.errors.push("verify.py not found in package");
      run.status = "VERIFY_FAILED";
      return run;
    }
    const ok = await executePipelineStep(run, "verify", "python", ["verify.py"], runDir, RUN_TIMEOUT_MS);
    if (!ok) return run;
    run.verifyRan = true;
    run.verifyPassed = true;
  }

  run.status = run.errors.length === 0 ? "OUTPUTS_COLLECTED" : run.status;
  return run;
}

// ── Create run endpoint ────────────────────────────────────────────────
app.post("/api/runs", async (req, res) => {
  try {
    const { package_id, run_setup = true, run_solve = true, run_verify = true } = req.body || {};
    if (!package_id || !packages.has(package_id)) {
      res.status(404).json({ ok: false, error: "Package not found" });
      return;
    }

    const run = await createRun(package_id, { run_setup, run_solve, run_verify });
    if (run.error) {
      res.status(400).json({ ok: false, error: run.error });
      return;
    }

    res.status(201).json({
      ok: true,
      run_id: run.runId,
      status: run.status
    });
  } catch (err) {
    console.error("[runner] run error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Get run status ─────────────────────────────────────────────────────
app.get("/api/runs/:runId", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) {
    res.status(404).json({ ok: false, error: "Run not found" });
    return;
  }
  res.json({
    ok: true,
    run_id: run.runId,
    status: run.status,
    task_family: run.family,
    solve_ran: run.solveRan,
    verify_ran: run.verifyRan,
    verify_passed: run.verifyPassed,
    outputs_exist: run.outputsExist
  });
});

// ── Get run logs ───────────────────────────────────────────────────────
app.get("/api/runs/:runId/logs", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) {
    res.status(404).json({ ok: false, error: "Run not found" });
    return;
  }
  res.json({
    ok: true,
    run_id: run.runId,
    logs: run.logs,
    errors: run.errors
  });
});

// ── Get run outputs (file names, sizes, checksums, parsed contents) ──
app.get("/api/runs/:runId/outputs", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) {
    res.status(404).json({ ok: false, error: "Run not found" });
    return;
  }

  const outputsDir = path.join(run.workspace, "outputs");
  if (!fs.existsSync(outputsDir)) {
    res.status(404).json({ ok: false, error: "No outputs directory found" });
    return;
  }

  const files = {};
  try {
    const entries = fs.readdirSync(outputsDir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(outputsDir, entry.name);
      if (entry.isFile()) {
        const stat = fs.statSync(filePath);
        const buf = fs.readFileSync(filePath);
        const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
        const isBinary = /\.(bundle|zip|png|jpg|jpeg|gif|ico|pdf|exe|dll|so|dylib)$/i.test(entry.name);
        const info = {
          name: entry.name,
          size: stat.size,
          sha256,
        };
        if (isBinary) {
          info.type = "binary";
          info.content = null;
        } else if (/\.json$/i.test(entry.name)) {
          try {
            info.type = "json";
            info.content = JSON.parse(buf.toString("utf8"));
          } catch {
            info.type = "text";
            info.content = buf.toString("utf8");
          }
        } else {
          info.type = "text";
          info.content = buf.toString("utf8");
        }
        files[entry.name] = info;
      }
    }
    res.json({ ok: true, run_id: run.runId, status: run.status, files });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Update run status (COMPUTED_PASS / DO_NOT_SUBMIT) ─────────────────
app.patch("/api/runs/:runId/status", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) {
    res.status(404).json({ ok: false, error: "Run not found" });
    return;
  }

  const { status } = req.body || {};
  if (!status || !["COMPUTED_PASS", "DO_NOT_SUBMIT"].includes(status)) {
    res.status(400).json({ ok: false, error: "Invalid status. Must be COMPUTED_PASS or DO_NOT_SUBMIT." });
    return;
  }

  run.status = status;
  res.json({ ok: true, run_id: run.runId, status: run.status });
});

// ── Start server ───────────────────────────────────────────────────────
ensureDir(WORKSPACES_DIR);

app.listen(PORT, HOST, () => {
  console.log(`[runner] Selection Improvement Runner listening on http://${HOST}:${PORT}`);
  console.log(`[runner] Python: ${RUNTIMES.python || "not found"}`);
  console.log(`[runner] Node:   ${RUNTIMES.node || "not found"}`);
  console.log(`[runner] Git:    ${RUNTIMES.git || "not found"}`);
});
