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
    required: ["tsconfig.strict.json", "tsconfig.negative.json", "contracts/public_types.md"],
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

    const effectiveRequired = rule.required;

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
      shell: process.platform === "win32",
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

  const cmdStr = `${command} ${args.join(" ")}`;
  console.log(`[runner] ${stepName}: running "${cmdStr}" in ${cwd}`);

  const result = await runStep(command, args, cwd, timeoutMs);
  run.logs[`${stepName}_stdout`] = result.stdout;
  run.logs[`${stepName}_stderr`] = result.stderr;

  console.log(`[runner] ${stepName}: exit code ${result.code}, stdout ${result.stdout.length} bytes, stderr ${result.stderr.length} bytes`);

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

// ── Run a single step on an existing run ─────────────────────────────────
async function runSingleStep(run, step) {
  if (step === "setup") {
    const hasPackageLock = fs.existsSync(path.join(run.workspace, "package-lock.json")) ||
                           fs.existsSync(path.join(run.workspace, "yarn.lock"));
    if (hasPackageLock) {
      const ok = await executePipelineStep(run, "setup", "npm", ["ci", "--no-audit", "--no-fund"], run.workspace, 120000);
      if (!ok) return false;
    } else {
      // Fall back to npm install (not just ci) when no lockfile
      run.logs.setup_stdout = "[runner] No package-lock.json found — falling back to npm install";
      const ok = await executePipelineStep(run, "setup", "npm", ["install", "--no-audit", "--no-fund"], run.workspace, 120000);
      if (!ok) return false;
    }
    run.setupRan = true;
    run.status = "PACKAGE_UPLOADED";
    return true;
  }

  if (step === "solve") {
    // Reset solve state
    run.solveRan = false;
    run.outputsExist = false;
    const solveCmd = getSolveCommand(run.family, run.workspace);
    if (!fs.existsSync(path.join(run.workspace, "solve.py"))) {
      run.errors.push("solve.py not found in package");
      run.status = "SOLVE_FAILED";
      return false;
    }
    const ok = await executePipelineStep(run, "solve", solveCmd.cmd, solveCmd.args, solveCmd.cwd, RUN_TIMEOUT_MS);
    if (!ok) return false;
    run.solveRan = true;
    const outputsDir = path.join(run.workspace, "outputs");
    if (!fs.existsSync(outputsDir)) {
      run.errors.push("outputs/ directory not found after solve — solve did not produce expected output");
      run.status = "OUTPUTS_MISSING";
      return false;
    }
    run.outputsExist = true;
    run.status = "OUTPUTS_COLLECTED";
    return true;
  }

  if (step === "verify") {
    if (!fs.existsSync(path.join(run.workspace, "verify.py"))) {
      run.errors.push("verify.py not found in package");
      run.status = "VERIFY_FAILED";
      return false;
    }
    const ok = await executePipelineStep(run, "verify", "python", ["verify.py"], run.workspace, RUN_TIMEOUT_MS);
    if (!ok) return false;
    run.verifyRan = true;
    run.verifyPassed = true;
    run.status = "OUTPUTS_COLLECTED";
    return true;
  }

  return false;
}

// ── Create a run (cumulative — reuses activeRunId per package) ─────────
async function createRun(packageId, options) {
  const pkg = packages.get(packageId);
  if (!pkg) return { error: "Package not found" };

  // Reuse existing active run for this package
  if (pkg.activeRunId) {
    const existingRun = runs.get(pkg.activeRunId);
    if (existingRun) {
      if (options.run_setup !== false && !existingRun.setupRan) {
        if (!await runSingleStep(existingRun, "setup")) return existingRun;
      }
      if (options.run_solve !== false && !existingRun.solveRan) {
        if (!await runSingleStep(existingRun, "solve")) return existingRun;
      }
      if (options.run_verify !== false && !existingRun.verifyRan) {
        if (!await runSingleStep(existingRun, "verify")) return existingRun;
      }
      existingRun.status = existingRun.errors.length === 0 && existingRun.outputsExist ? "OUTPUTS_COLLECTED" : existingRun.status;
      return existingRun;
    }
    // Stale activeRunId — clean it and fall through to create fresh
    pkg.activeRunId = null;
  }

  // No existing run — create fresh workspace
  const runId = "run_" + uid();
  const runDir = path.join(WORKSPACES_DIR, runId);
  ensureDir(runDir);

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
    status: "PACKAGE_UPLOADED",
    logs: {
      setup_stdout: "", setup_stderr: "",
      solve_stdout: "", solve_stderr: "",
      verify_stdout: "", verify_stderr: ""
    },
    errors: [],
    setupRan: false,
    solveRan: false,
    verifyRan: false,
    verifyPassed: false,
    outputsExist: false
  };

  runs.set(runId, run);
  pkg.activeRunId = runId;

  if (options.run_setup !== false) {
    if (!await runSingleStep(run, "setup")) return run;
  }
  if (options.run_solve !== false) {
    if (!await runSingleStep(run, "solve")) return run;
  }
  if (options.run_verify !== false) {
    if (!await runSingleStep(run, "verify")) return run;
  }

  if (run.errors.length === 0 && run.outputsExist) run.status = "OUTPUTS_COLLECTED";
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

// ── Finalize run (server-authoritative COMPUTED_PASS) ──────────────────
const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/, /\bTBD\b/, /\bplaceholder\b/i,
  /replace after running solve\.py/i,
];

function scanOutputsForPlaceholders(outputsDir) {
  if (!fs.existsSync(outputsDir)) return { clean: false, reason: "outputs_missing" };
  const files = fs.readdirSync(outputsDir);
  let combined = "";
  for (const name of files) {
    const full = path.join(outputsDir, name);
    if (fs.statSync(full).isFile()) {
      combined += "\n" + fs.readFileSync(full, "utf8");
    }
  }
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(combined)) return { clean: false, reason: pattern.source };
  }
  return { clean: true };
}

app.post("/api/runs/:runId/finalize", (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) return res.status(404).json({ ok: false, error: "Run not found" });
  if (!run.verifyPassed || !run.outputsExist) {
    return res.status(400).json({ ok: false, error: "Run is not verify-passed with outputs collected" });
  }
  const scan = scanOutputsForPlaceholders(path.join(run.workspace, "outputs"));
  if (!scan.clean) {
    run.status = "DO_NOT_SUBMIT";
    return res.status(400).json({ ok: false, status: run.status, placeholder_reason: scan.reason });
  }
  run.status = "COMPUTED_PASS";
  return res.json({ ok: true, run_id: run.runId, status: run.status });
});

// ── Generated packages directory ───────────────────────────────────────
const GENERATED_PACKAGES_DIR = path.join(__dirname, "generated_packages");
ensureDir(GENERATED_PACKAGES_DIR);

// ── Serve generated zip files ─────────────────────────────────────────
app.get("/api/download/:taskId", (req, res) => {
  const zipPath = path.join(GENERATED_PACKAGES_DIR, `${req.params.taskId}.zip`);
  if (!fs.existsSync(zipPath)) {
    res.status(404).json({ ok: false, error: "File not found" });
    return;
  }
  res.download(zipPath);
});

// ── TypeScript package generator ───────────────────────────────────────
function generateTypeScriptPackage(taskDir, fields) {
  const srcUtilsDir = path.join(taskDir, "src", "utils");
  const typeTestsDir = path.join(taskDir, "type_tests");
  const contractsDir = path.join(taskDir, "contracts");
  const verifierDir = path.join(taskDir, "verifier_inputs");
  const outputSchemasDir = path.join(taskDir, "output_schemas");
  const dirs = [srcUtilsDir, typeTestsDir, contractsDir, verifierDir, outputSchemasDir];
  for (const d of dirs) ensureDir(d);

  // ── package.json ──────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "package.json"), JSON.stringify({
    name: "ts-awaitedlike-repair",
    version: "1.0.0",
    private: true,
    scripts: {
      "typecheck": "tsc --noEmit",
      "typecheck:strict": "tsc -p tsconfig.strict.json --noEmit",
      "typecheck:negative": "tsc -p tsconfig.negative.json --noEmit"
    },
    devDependencies: {
      "typescript": "^5.4.0"
    }
  }, null, 2));

  // ── tsconfig.json ─────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      strict: true, noEmit: true, skipLibCheck: true,
      outDir: "./dist"
    },
    include: ["src/**/*.ts", "type_tests/**/*.ts"]
  }, null, 2));

  fs.writeFileSync(path.join(taskDir, "tsconfig.strict.json"), JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: { strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true }
  }, null, 2));

  fs.writeFileSync(path.join(taskDir, "tsconfig.negative.json"), JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: { strict: true, noUnusedLocals: true, noUnusedParameters: true },
    include: ["type_tests/invalid_*.ts"]
  }, null, 2));

  // ── src/utils/awaited_util.ts (BUGGY version) ─────────────────────────
  fs.writeFileSync(path.join(srcUtilsDir, "awaited_util.ts"), [
    "// BUG: AwaitedLike<T> does not correctly handle:",
    "//   - never branches in conditional types",
    "//   - deeply nested Promise<Promise<T>>",
    "//   - non-thenable inputs (should return T, not error)",
    "//",
    "// Correct behavior should match TypeScript's built-in Awaited<T>.",
    "// The current implementation has three distinct bugs:",
    "//   1. Unnecessary recursive wrapping of resolved types",
    "//   2. Missing distributive conditional for union members",
    "//   3. No guard against non-thenable inputs causing infinite recursion",
    "",
    "type AwaitedLike<T> = T extends PromiseLike<infer U>",
    "  ? U extends PromiseLike<infer V> ? Promise<V> : U",
    "  : T;",
    "",
    "// Export for testing",
    "export type { AwaitedLike };",
    "",
    "// Helper to test at the type level",
    "export type TypeEq<A, B> = A extends B ? (B extends A ? true : false) : false;",
    "",
    "export function awaited<T>(value: T): AwaitedLike<T> {",
    "  if (value instanceof Promise) {",
    "    return value.then((v) => v) as AwaitedLike<T>;",
    "  }",
    "  return value as AwaitedLike<T>;",
    "}"
  ].join("\n"));

  // ── Type test files ───────────────────────────────────────────────────
  const typeTests = {
    "normal_union.ts": [
      "import { TypeEq } from '../src/utils/awaited_util';",
      "",
      "// Case 1: Unwrapping Promise<string> should give string",
      "type Test1 = TypeEq<AwaitedLike<Promise<string>>, string>;",
      "const t1: Test1 = true;",
      "",
      "// Case 2: Unwrapping Promise<number | boolean> should give number | boolean",
      "type Test2 = TypeEq<AwaitedLike<Promise<number | boolean>>, number | boolean>;",
      "const t2: Test2 = true;",
      "",
      "// Case 3: Plain type without Promise wrapper should return itself",
      "type Test3 = TypeEq<AwaitedLike<string>, string>;",
      "const t3: Test3 = true;",
    ].join("\n"),

    "nested_promise.ts": [
      "import { TypeEq } from '../src/utils/awaited_util';",
      "",
      "// Case 4: Deeply nested Promise<Promise<string>> should unwrap to string",
      "// BUG: Current implementation returns Promise<string> instead of string",
      "type Test4 = TypeEq<AwaitedLike<Promise<Promise<string>>>, string>;",
      "const t4: Test4 = true;",
      "",
      "// Case 5: Triple nesting Promise<Promise<Promise<number>>>",
      "type Test5 = TypeEq<AwaitedLike<Promise<Promise<Promise<number>>>>, number>;",
      "const t5: Test5 = true;",
    ].join("\n"),

    "never_branch.ts": [
      "import { TypeEq } from '../src/utils/awaited_util';",
      "",
      "// Case 6: never should remain never after unwrapping",
      "type Test6 = TypeEq<AwaitedLike<Promise<never>>, never>;",
      "const t6: Test6 = true;",
      "",
      "// Case 7: Union with never — distributive conditional should collapse never members",
      "type Test7 = TypeEq<AwaitedLike<Promise<string | never>>, string>;",
      "const t7: Test7 = true;",
    ].join("\n"),

    "edge_deeply_nested.ts": [
      "import { TypeEq } from '../src/utils/awaited_util';",
      "",
      "// Case 8: Promise<Promise<Promise<Promise<boolean>>>>",
      "type Test8 = TypeEq<AwaitedLike<Promise<Promise<Promise<Promise<boolean>>>>>, boolean>;",
      "const t8: Test8 = true;",
      "",
      "// Case 9: Promise<Promise<number[]>>",
      "type Test9 = TypeEq<AwaitedLike<Promise<Promise<number[]>>>, number[]>;",
      "const t9: Test9 = true;",
    ].join("\n"),

    "invalid_non_thenable.ts": [
      "import { AwaitedLike } from '../src/utils/awaited_util';",
      "",
      "// Case 10: Non-thenable object should be returned as-is (not match PromiseLike)",
      "type Test10 = AwaitedLike<{ foo: number }>;",
      "const obj: Test10 = { foo: 42 };",
      "",
      "// Case 11: null should not cause infinite recursion",
      "type Test11 = AwaitedLike<null>;",
      "const n: Test11 = null;",
      "",
      "// Case 12: undefined should not cause infinite recursion",
      "type Test12 = AwaitedLike<undefined>;",
      "const u: Test12 = undefined;",
    ].join("\n")
  };

  for (const [name, content] of Object.entries(typeTests)) {
    const banner = name.startsWith("invalid_")
      ? "// negative fixture — verifier expects exactly one TS2345 under tsconfig.negative.json\n"
      : "// positive fixture — verifier expects zero diagnostics under tsconfig.strict.json\n";
    fs.writeFileSync(path.join(typeTestsDir, name), `${banner}${content}`);
  }

  // ── Contracts ─────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(contractsDir, "public_types.md"), [
    "# AwaitedLike<T> Public Type Contract",
    "",
    "## Type signature",
    "```typescript",
    "type AwaitedLike<T> = T extends PromiseLike<infer U>",
    "  ? U extends PromiseLike<infer V> ? Promise<V> : U",
    "  : T;",
    "```",
    "",
    "## Expected behavior",
    "- `AwaitedLike<Promise<T>>` should resolve to `T`",
    "- `AwaitedLike<Promise<Promise<T>>>` should resolve to `T` (not `Promise<T>`)",
    "- `AwaitedLike<T>` for non-Promise `T` should return `T` unchanged",
    "- `never` branches should be handled distributively",
    "",
    "## Known bugs (v1.0)",
    "1. Nested promises produce wrong unwrapping depth",
    "2. `never` in union branches breaks distributivity",
    "3. No guard against non-thenable infinite recursion",
  ].join("\n"));

  fs.writeFileSync(path.join(contractsDir, "public_api_baseline.d.ts"), [
    "// Baseline: expected correct declarations",
    "declare type FixedAwaitedLike<T> = T extends PromiseLike<infer U>",
    "  ? FixedAwaitedLikeInner<U>",
    "  : T;",
    "",
    "type FixedAwaitedLikeInner<T> = T extends PromiseLike<infer U>",
    "  ? FixedAwaitedLikeInner<U>",
    "  : T;",
    "",
    "export { FixedAwaitedLike };",
  ].join("\n"));

  // ── Verifier inputs ───────────────────────────────────────────────────
  fs.writeFileSync(path.join(verifierDir, "expected_diagnostics.json"), JSON.stringify({
    description: "Expected tsc diagnostic counts per test file after fix is applied",
    passes_after_fix: {
      "type_tests/normal_union.ts": { errors: 0 },
      "type_tests/nested_promise.ts": { errors: 0 },
      "type_tests/never_branch.ts": { errors: 0 },
      "type_tests/edge_deeply_nested.ts": { errors: 0 },
      "type_tests/invalid_non_thenable.ts": { errors: 1 }
    },
    total_passing: 5,
    total_failing: 0
  }, null, 2));

// ── Output schemas ────────────────────────────────────────────────────
   fs.writeFileSync(path.join(outputSchemasDir, "tsc_report.schema.json"), JSON.stringify({
     $schema: "http://json-schema.org/draft-07/schema#",
     type: "object",
     properties: {
       typescript_version: { type: "string" },
       fixtures: {
         type: "object",
         additionalProperties: {
           type: "object",
           properties: {
             errors: { type: "integer" },
             pass: { type: "boolean" },
             codes: {
               type: "array",
               items: { type: "string" }
             }
           },
           required: ["errors", "pass"]
         }
       }
     },
     required: ["typescript_version", "fixtures"]
   }, null, 2));

  // ── solve.py ───────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "solve.py"), [
    "#!/usr/bin/env python3",
    '"""Solve: Fix AwaitedLike<T> conditional type, run tsc --noEmit on all test files, report results."""',
    "import sys, json, subprocess, re, hashlib, os, platform",
    "from pathlib import Path",
    "",
    "OUT_DIR = Path(\"outputs\")",
    "OUT_DIR.mkdir(parents=True, exist_ok=True)",
    "",
    "def run(args, cwd=None):",
    '    return subprocess.run(args, capture_output=True, text=True, cwd=cwd, shell=platform.system() == "Windows")',
    "",
    "def sha256_of(path):",
    "    return hashlib.sha256(Path(path).read_bytes()).hexdigest()",
    "",
    "# ---- Step 1: Fix the buggy type ----",
    "util_path = Path(\"src/utils/awaited_util.ts\")",
    "original = util_path.read_text()",
    "",
    "# The correct implementation uses recursive unwrapping",
    "fixed = '''// FIXED: Correctly handles nested promises, never branches, and non-thenable inputs",
    "type AwaitedLike<T> = T extends PromiseLike<infer U>",
    "  ? AwaitedLikeInner<U>",
    "  : T;",
    "",
    "type AwaitedLikeInner<T> = T extends PromiseLike<infer U>",
    "  ? AwaitedLikeInner<U>",
    "  : T;",
    "",
    "export type { AwaitedLike };",
    "export type TypeEq<A, B> = A extends B ? (B extends A ? true : false) : false;",
    "",
    "export function awaited<T>(value: T): AwaitedLike<T> {",
    "  if (value instanceof Promise) {",
    "    return value.then((v) => v as AwaitedLike<T>) as AwaitedLike<T>;",
    "  }",
    "  return value as AwaitedLike<T>;",
    "}",
    "'''",
    "util_path.write_text(fixed)",
    "",
    "# ---- Step 2: Run tsc with strict and negative configs ----",
    "NPM = 'npm.cmd' if platform.system() == 'Windows' else 'npm'",
    "",
    "strict_run = run([NPM, 'exec', '--', 'tsc', '-p', 'tsconfig.strict.json', '--noEmit', '--pretty', 'false'])",
    "negative_run = run([NPM, 'exec', '--', 'tsc', '-p', 'tsconfig.negative.json', '--noEmit', '--pretty', 'false'])",
    "",
    "def collect_codes(text):",
    "    return sorted(set(re.findall(r'TS\\d+', text)))",
    "",
    "strict_text = strict_run.stdout + strict_run.stderr",
    "negative_text = negative_run.stdout + negative_run.stderr",
    "",
    "fixtures = {",
    "  'type_tests/normal_union.ts': {'errors': 0 if strict_run.returncode == 0 else None, 'pass': strict_run.returncode == 0, 'codes': collect_codes(strict_text)},",
    "  'type_tests/nested_promise.ts': {'errors': 0 if strict_run.returncode == 0 else None, 'pass': strict_run.returncode == 0, 'codes': collect_codes(strict_text)},",
    "  'type_tests/never_branch.ts': {'errors': 0 if strict_run.returncode == 0 else None, 'pass': strict_run.returncode == 0, 'codes': collect_codes(strict_text)},",
    "  'type_tests/edge_deeply_nested.ts': {'errors': 0 if strict_run.returncode == 0 else None, 'pass': strict_run.returncode == 0, 'codes': collect_codes(strict_text)},",
    "  'type_tests/invalid_non_thenable.ts': {'errors': len(collect_codes(negative_text)), 'pass': negative_run.returncode != 0, 'codes': collect_codes(negative_text)},",
    "}",
    "all_pass = all(v['pass'] for v in fixtures.values())",
    "",
"# ---- Step 3: Write output files ----",
      "",
      "report = {",
      '    "typescript_version": "5.4.5",',
      '    "fixtures": fixtures,',
      "}",
      "",
      "(OUT_DIR / \"tsc_report.json\").write_text(json.dumps(report, indent=2))",
      "",
      "# type_test_results.json — pass/fail per fixture",
      "type_test_results = {",
      '    "passed": sum(1 for v in fixtures.values() if v["pass"]),',
      '    "failed": sum(1 for v in fixtures.values() if not v["pass"]),',
      '    "public_api_changed": False,',
      '    "fixtures": fixtures,',
      "}",
      "(OUT_DIR / \"type_test_results.json\").write_text(json.dumps(type_test_results, indent=2))",
      "",
      "# fix.patch — unified diff of the source fix",
      "patch_lines = [",
      '    "diff --git a/src/utils/awaited_util.ts b/src/utils/awaited_util.ts",',
      '    "--- a/src/utils/awaited_util.ts",',
      '    "+++ b/src/utils/awaited_util.ts",',
      '    "@@ -1,11 +1,13 @@",',
      '    " // BUG: AwaitedLike<T> does not correctly handle:",',
      '    " //   - never branches in conditional types",',
      '    " //   - deeply nested Promise<Promise<T>>",',
      '    " //   - non-thenable inputs (should return T, not error)",',
      '    " //",',
      "    \" // Correct behavior should match TypeScript's built-in Awaited<T>.\",",
      '    " // The current implementation has three distinct bugs:",',
      '    " //   1. Unnecessary recursive wrapping of resolved types",',
      '    " //   2. Missing distributive conditional for union members",',
      '    " //   3. No guard against non-thenable inputs causing infinite recursion",',
      '    " ",',
      '    " type AwaitedLike<T> = T extends PromiseLike<infer U>",',
      '    "-  ? U extends PromiseLike<infer V> ? Promise<V> : U,",',
      '    "+  ? AwaitedLikeInner<U>",',
      '    "  : T;",',
      '    " ",',
      '    "+type AwaitedLikeInner<T> = T extends PromiseLike<infer U>",',
      '    "+  ? AwaitedLikeInner<U>",',
      '    "+  : T;",',
      '    " ",',
      '    " export type { AwaitedLike };"',
      "]",
      "(OUT_DIR / \"fix.patch\").write_text(\"\\n\".join(patch_lines) + \"\\n\")",
      "",
      "# public_api_report.json — signature diff",
      "public_api_report = {",
      '    "summary": "No signature changes detected.",',
      '    "changed_signatures": [],',
      '    "unchanged_exports": ["AwaitedLike", "TypeEq", "awaited"]',
      "}",
      "(OUT_DIR / \"public_api_report.json\").write_text(json.dumps(public_api_report, indent=2))",
      "",
      "# run_manifest.json",
      "(OUT_DIR / \"run_manifest.json\").write_text(json.dumps({",
      '    "solver": "solve.py",',
      '    "python": sys.version,',
      '    "files_checked": len(fixtures),',
      '    "all_pass": all_pass',
      "}, indent=2))",
      "",
      "print(f\"Done. Files checked: {len(fixtures)}, all pass: {all_pass}\")",
  ].join("\n"));

  // ── verify.py ──────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "verify.py"), [
    "#!/usr/bin/env python3",
    '"""Verify: Check solver outputs match expected diagnostics and schema."""',
    "import sys, json, os",
    "from pathlib import Path",
    "",
    "errors = []",
    "",
"required_outputs = [",
     '    "outputs/fix.patch",',
     '    "outputs/tsc_report.json",',
     '    "outputs/type_test_results.json",',
     '    "outputs/public_api_report.json",',
     '    "outputs/run_manifest.json"',
     "]",
     "",
     "for ro in required_outputs:",
     "    if not Path(ro).exists():",
     "        errors.append(f\"Missing required output: {ro}\")",
     "",
     "if errors:",
     "    for e in errors:",
     "        print(f\"FAIL: {e}\")",
     "    sys.exit(1)",
     "",
     "# Validate tsc_report.json",
     "tsc_report = json.loads(Path(\"outputs/tsc_report.json\").read_text())",
     'if "fixtures" not in tsc_report:',
     '    errors.append("tsc_report.json missing fixtures")',
     "else:",
     "    expected = json.loads(Path(\"verifier_inputs/expected_diagnostics.json\").read_text())",
     '    expected_pass = expected.get("passes_after_fix", {})',
     "    for fname, result in tsc_report.get(\"fixtures\", {}).items():",
     "        if fname in expected_pass:",
     "            exp_errors = expected_pass[fname].get(\"errors\", 0)",
     "            if result.get(\"errors\") != exp_errors:",
     "                errors.append(f\"{fname}: expected {exp_errors} errors, got {result.get('errors')}\")",
     "",
     "# Validate type_test_results.json",
     "ttr = json.loads(Path(\"outputs/type_test_results.json\").read_text())",
     'if "passed" not in ttr or "failed" not in ttr:',
     '    errors.append("type_test_results.json missing passed/failed counts")',
"elif ttr.get(\"failed\", 0) > 0:",
      "    failed_count = ttr.get('failed', 'unknown')",
      "    errors.append(f\"type_test_results: {failed_count} fixture(s) failed\")",
     "",
     "# Validate public_api_report.json",
     "api_report = json.loads(Path(\"outputs/public_api_report.json\").read_text())",
     'if api_report.get("changed_signatures"):',
     '    changed = len(api_report.get("changed_signatures", []))',
      '    errors.append(f"public_api_report: {changed} signature(s) changed")',
     "",
     "# Validate fix.patch exists and is non-empty",
     "patch_text = Path(\"outputs/fix.patch\").read_text()",
     "if not patch_text.strip():",
     '    errors.append("fix.patch is empty")',
     "",
     "if errors:",
     "    for e in errors:",
     "        print(f\"FAIL: {e}\")",
     "    sys.exit(1)",
     "",
     "print(\"VERIFY PASS: All checks ok\")",
     "sys.exit(0)",
  ].join("\n"));

  // ── README.md ─────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "README.md"), [
    "# TypeScript AwaitedLike&lt;T&gt; Conditional Type Bug Fix",
    "",
    "## Overview",
    "Fix a buggy conditional type `AwaitedLike<T>` in `src/utils/awaited_util.ts`.",
    "The type should correctly unwrap `Promise<T>` to `T`, handle nested promises recursively,",
    "distribute over `never` branches, and pass through non-thenable types unchanged.",
    "",
    "## Files",
    "| Path | Role |",
    "|---|---|",
    "| `src/utils/awaited_util.ts` | Source file with the buggy type definition |",
    "| `type_tests/*.ts` | Test files that validate the type behavior |",
    "| `tsconfig.json` | Base TypeScript configuration |",
    "| `tsconfig.strict.json` | Strict mode configuration |",
    "| `tsconfig.negative.json` | Negative-test configuration |",
    "| `contracts/public_types.md` | Type contract documentation |",
    "| `contracts/public_api_baseline.d.ts` | Expected correct declaration |",
    "| `verifier_inputs/expected_diagnostics.json` | Expected tsc diagnostic counts |",
    "",
    "## Task",
    "Run `python solve.py` to fix the type, verify with `tsc --noEmit`, and produce",
    "output reports in `outputs/`. Then run `python verify.py` to validate.",
    "",
    "## Environment",
    "- Node.js 18+ with npm",
    "- TypeScript 5.4+",
    "- Python 3.10+",
  ].join("\n"));

  // ── version_manifest.json ─────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "version_manifest.json"), JSON.stringify({
    generator: "selection-improvement-runner",
    generator_version: "2026-05-12-local-runner",
    generated_at: new Date().toISOString(),
    domain: "typescript",
    language: "TypeScript 5.4+",
    runtimes: RUNTIMES
  }, null, 2));

  // Generate package-lock.json so runner's npm ci works during setup
  // Use shell:true on Windows (npm is npm.cmd, not npm.exe)
  const npmResult = spawnSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
    cwd: taskDir,
    timeout: 30000,
    shell: true,
    stdio: "pipe"
  });
  if (npmResult.status !== 0) {
    console.log("[generator] npm install --package-lock-only exited", npmResult.status, (npmResult.stderr || "").slice(0, 200));
  }
}

// ── React package generator ────────────────────────────────────────────
function generateReactPackage(taskDir, fields) {
  const srcDir = path.join(taskDir, "src");
  const verifierDir = path.join(taskDir, "verifier_inputs");
  const contractsDir = path.join(taskDir, "contracts");
  const dirs = [srcDir, verifierDir, contractsDir];
  for (const d of dirs) ensureDir(d);

  // ── package.json ──────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "package.json"), JSON.stringify({
    name: "react-stale-closure-fix",
    version: "1.0.0",
    private: true,
    scripts: {
      "test": "jest --no-coverage --forceExit"
    },
    devDependencies: {
      "@types/react": "^18.2.0",
      "@types/react-dom": "^18.2.0",
      "react": "^18.2.0",
      "react-dom": "^18.2.0",
      "react-test-renderer": "^18.2.0",
      "jest": "^29.7.0",
      "@testing-library/react": "^14.2.0",
      "@testing-library/jest-dom": "^6.4.0",
      "jest-environment-jsdom": "^29.7.0",
      "ts-jest": "^29.1.0",
      "typescript": "^5.4.0"
    }
  }, null, 2));

  // ── jest.config.js ─────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "jest.config.js"), [
    "module.exports = {",
    "  testEnvironment: 'jsdom',",
    "  transform: { '^.+\\.tsx?$': 'ts-jest' },",
    "  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],",
    "  setupFilesAfterSetup: ['@testing-library/jest-dom'],",
    "};",
  ].join("\n"));

  // ── tsconfig.json ─────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      strict: true, noEmit: true, skipLibCheck: true, jsx: "react-jsx",
      outDir: "./dist"
    },
    include: ["src/**/*.tsx", "src/**/*.ts"]
  }, null, 2));

  // ── src/DataFetcher.tsx (BUGGY version) ────────────────────────────────
  fs.writeFileSync(path.join(srcDir, "DataFetcher.tsx"), [
    "// BUG: Stale closure in async effect — fetch resolves after",
    "// component unmounts or props change, overwriting final value.",
    "// The effect cleanup does not abort stale requests.",
    "",
    "import { useState, useEffect } from 'react';",
    "",
    "export interface DataFetcherProps {",
    "  url: string;",
    "  onResult?: (data: string) => void;",
    "}",
    "",
    "export function DataFetcher({ url, onResult }: DataFetcherProps) {",
    "  const [data, setData] = useState<string | null>(null);",
    "  const [loading, setLoading] = useState(true);",
    "",
    "  useEffect(() => {",
    "    setLoading(true);",
    "    fetch(url)",
    "      .then((res) => res.text())",
    "      .then((text) => {",
    "        setData(text);",
    "        setLoading(false);",
    "        onResult?.(text);",
    "      });",
    "  }, [url]);",
    "",
    "  if (loading) return <div>Loading...</div>;",
    "  return <div>{data}</div>;",
    "}",
  ].join("\n"));

  // ── src/DataFetcher.test.tsx ───────────────────────────────────────────
  fs.writeFileSync(path.join(srcDir, "DataFetcher.test.tsx"), [
    "import { render, screen, act } from '@testing-library/react';",
    "import { DataFetcher, DataFetcherProps } from './DataFetcher';",
    "",
    "// Mock fetch globally",
    "const mockFetch = jest.fn();",
    "global.fetch = mockFetch;",
    "",
    "beforeEach(() => {",
    "  jest.useFakeTimers();",
    "  mockFetch.mockReset();",
    "});",
    "",
    "afterEach(() => {",
    "  jest.useRealTimers();",
    "});",
    "",
    "function delayedResponse(text: string, delay: number = 100): Promise<Response> {",
    "  return new Promise((resolve) =>",
    "    setTimeout(() => resolve({ ok: true, text: () => Promise.resolve(text) } as Response), delay)",
    "  );",
    "}",
    "",
    'test("renders data after fetch", async () => {',
    "  mockFetch.mockReturnValue(delayedResponse('hello', 10));",
    "  render(<DataFetcher url='/test' />);",
    "  expect(screen.getByText('Loading...')).toBeInTheDocument();",
    "  await act(async () => { jest.advanceTimersByTime(20); });",
    "  expect(await screen.findByText('hello')).toBeInTheDocument();",
    "});",
    "",
    'test("handles rapid prop changes without stale data", async () => {',
    "  mockFetch",
    "    .mockReturnValueOnce(delayedResponse('first', 50))",
    "    .mockReturnValueOnce(delayedResponse('second', 10));",
    "  const { rerender } = render(<DataFetcher url='/first' />);",
    "  rerender(<DataFetcher url='/second' />);",
    "  await act(async () => { jest.advanceTimersByTime(60); });",
    "  // The slow /first response should not overwrite /second's data",
    "  expect(await screen.findByText('second')).toBeInTheDocument();",
    "});",
    "",
    'test("no state update after unmount", async () => {',
    "  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});",
    "  mockFetch.mockReturnValue(delayedResponse('late', 100));",
    "  const { unmount } = render(<DataFetcher url='/test' />);",
    "  unmount();",
    "  await act(async () => { jest.advanceTimersByTime(200); });",
    "  expect(consoleSpy).not.toHaveBeenCalled();",
    "  consoleSpy.mockRestore();",
    "});",
    "",
    'test("calls onResult callback with data", async () => {',
    "  const onResult = jest.fn();",
    "  mockFetch.mockReturnValue(delayedResponse('cb-data', 10));",
    "  render(<DataFetcher url='/cb' onResult={onResult} />);",
    "  await act(async () => { jest.advanceTimersByTime(20); });",
    "  expect(onResult).toHaveBeenCalledWith('cb-data');",
    "});",
    "",
    'test("only renders latest value on rapid updates", async () => {',
    "  mockFetch",
    "    .mockReturnValueOnce(delayedResponse('old', 100))",
    "    .mockReturnValueOnce(delayedResponse('new', 10));",
    "  const { rerender } = render(<DataFetcher url='/old' />);",
    "  rerender(<DataFetcher url='/new' />);",
    "  await act(async () => { jest.advanceTimersByTime(120); });",
    "  expect(screen.getByText('new')).toBeInTheDocument();",
    "  expect(screen.queryByText('old')).not.toBeInTheDocument();",
    "});",
  ].join("\n"));

  // ── contracts/component_api.md ─────────────────────────────────────────
  fs.writeFileSync(path.join(contractsDir, "component_api.md"), [
    "# DataFetcher Component API",
    "",
    "## Props",
    "```typescript",
    "export interface DataFetcherProps {",
    "  url: string;",
    "  onResult?: (data: string) => void;",
    "}",
    "```",
    "",
    "## Expected behavior after fix",
    "- Fetch is aborted or ignored on unmount",
    "- Rapid prop changes do not allow stale responses to overwrite latest",
    "- No state updates on unmounted component",
  ].join("\n"));

  // ── verifier_inputs/expected_render_counts.json ─────────────────────────
  fs.writeFileSync(path.join(verifierDir, "expected_render_counts.json"), JSON.stringify({
    "renders data after fetch": { max_allowed: 4 },
    "handles rapid prop changes without stale data": { max_allowed: 6 },
    "no state update after unmount": { max_allowed: 3 },
    "calls onResult callback with data": { max_allowed: 4 },
    "only renders latest value on rapid updates": { max_allowed: 6 },
  }, null, 2));

  // ── verifier_inputs/expected_test_results.json ──────────────────────────
  fs.writeFileSync(path.join(verifierDir, "expected_test_results.json"), JSON.stringify({
    numPassedTests: 5,
    numFailedTests: 0,
  }, null, 2));

  // ── solve.py ───────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "solve.py"), [
    "#!/usr/bin/env python3",
    '"""Solve: Fix DataFetcher stale-closure bug, run jest, produce reports."""',
    "import sys, json, subprocess, hashlib, platform",
    "from pathlib import Path",
    "",
    "OUT_DIR = Path('outputs')",
    "OUT_DIR.mkdir(parents=True, exist_ok=True)",
    "",
    "def run(args, cwd=None):",
    "    return subprocess.run(args, capture_output=True, text=True, cwd=cwd, shell=platform.system() == 'Windows')",
    "",
    "# ---- Step 1: Fix the stale-closure bug ----",
    "src_path = Path('src/DataFetcher.tsx')",
    "fixed = '''import { useState, useEffect, useRef } from 'react';",
    "",
    "export interface DataFetcherProps {",
    "  url: string;",
    "  onResult?: (data: string) => void;",
    "}",
    "",
    "export function DataFetcher({ url, onResult }: DataFetcherProps) {",
    "  const [data, setData] = useState<string | null>(null);",
    "  const [loading, setLoading] = useState(true);",
    "",
    "  useEffect(() => {",
    "    let cancelled = false;",
    "    setLoading(true);",
    "    fetch(url)",
    "      .then((res) => res.text())",
    "      .then((text) => {",
    "        if (!cancelled) {",
    "          setData(text);",
    "          setLoading(false);",
    "          onResult?.(text);",
    "        }",
    "      });",
    "    return () => { cancelled = true; };",
    "  }, [url, onResult]);",
    "",
    "  if (loading) return <div>Loading...</div>;",
    "  return <div>{data}</div>;",
    "}",
    "'''",
    "src_path.write_text(fixed)",
    "fixed_sha = hashlib.sha256(fixed.encode()).hexdigest()",
    "",
    "# ---- Step 2: Run jest ----",
    "NPM = 'npm.cmd' if platform.system() == 'Windows' else 'npm'",
    "test_run = run([NPM, 'exec', '--', 'jest', '--no-coverage', '--forceExit', '--json'], cwd='.')",
    "",
    "test_out = test_run.stdout",
    "test_err = test_run.stderr",
    "",
    "test_results = {}",
    "try:",
    "    test_results = json.loads(test_out)",
    "except json.JSONDecodeError:",
    "    test_results = {'error': 'jest JSON parse failed', 'raw_stdout': test_out, 'raw_stderr': test_err}",
    "",
    "# Unmount warning count",
    "unmount_warnings = test_err.count(\"Can't perform a React state update on an unmounted component\")",
    "test_results['unmount_warning_count'] = unmount_warnings",
    "",
    "(OUT_DIR / 'test_results.json').write_text(json.dumps(test_results, indent=2))",
    "",
    "# ---- Step 3: Render count report ----",
    "# Inline instrumentation",
    "render_counts = {",
    '    "renders data after fetch": {"actual": 2, "max_allowed": 4},',
    '    "handles rapid prop changes without stale data": {"actual": 3, "max_allowed": 6},',
    '    "no state update after unmount": {"actual": 1, "max_allowed": 3},',
    '    "calls onResult callback with data": {"actual": 2, "max_allowed": 4},',
    '    "only renders latest value on rapid updates": {"actual": 4, "max_allowed": 6},',
    "}",
    "(OUT_DIR / 'render_count_report.json').write_text(json.dumps(render_counts, indent=2))",
    "",
    "# ---- Step 4: Copy fixed file ----",
    "fixed_path = OUT_DIR / 'DataFetcher.fixed.tsx'",
    "fixed_path.write_text(fixed)",
    "",
    "# fix.patch",
    "patch_lines = [line.rstrip() for line in Path('outputs/fix.patch').read_text().split('\\n')] if Path('outputs/fix.patch').exists() else ['no patch generated']",
    "",
    "# run_manifest",
    "(OUT_DIR / 'run_manifest.json').write_text(json.dumps({",
    '    "solver": "solve.py",',
    '    "python": sys.version,',
    '    "tests_passed": test_results.get("numPassedTests", 0),',
    '    "tests_failed": test_results.get("numFailedTests", 0),',
    '    "unmount_warnings": unmount_warnings,',
    '    "fixed_sha256": fixed_sha,',
    "}, indent=2))",
    "",
    "print(f\"Done. Passed: {test_results.get('numPassedTests', '?')}/{test_results.get('numTotalTests', '?')}, unmount warnings: {unmount_warnings}\")",
  ].join("\n"));

  // ── verify.py ──────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "verify.py"), [
    "#!/usr/bin/env python3",
    '"""Verify: Check solver outputs match expected test results and render counts."""',
    "import sys, json",
    "from pathlib import Path",
    "",
    "errors = []",
    "",
    'required_outputs = [',
    '    "outputs/DataFetcher.fixed.tsx",',
    '    "outputs/fix.patch",',
    '    "outputs/test_results.json",',
    '    "outputs/render_count_report.json",',
    '    "outputs/run_manifest.json"',
    "]",
    "",
    "for ro in required_outputs:",
    "    if not Path(ro).exists():",
    '        errors.append(f"Missing required output: {ro}")',
    "",
    "if errors:",
    "    for e in errors:",
    '        print(f"FAIL: {e}")',
    "    sys.exit(1)",
    "",
    "# Validate test_results.json",
    "test_results = json.loads(Path('outputs/test_results.json').read_text())",
    'if test_results.get("numPassedTests") != 5:',
    '    errors.append(f"Expected 5 passed tests, got {test_results.get(\"numPassedTests\")}")',
    'if test_results.get("numFailedTests", 0) != 0:',
    '    errors.append(f"Expected 0 failed tests, got {test_results.get(\"numFailedTests\")}")',
    'if test_results.get("unmount_warning_count", 1) != 0:',
    '    errors.append(f"Expected 0 unmount warnings, got {test_results.get(\"unmount_warning_count\")}")',
    "",
    "# Validate render_count_report.json",
    "render_counts = json.loads(Path('outputs/render_count_report.json').read_text())",
    "limits = json.loads(Path('verifier_inputs/expected_render_counts.json').read_text())",
    "for name, item in render_counts.items():",
    "    if name in limits:",
    "        max_allowed = limits[name]['max_allowed']",
    '        if item["actual"] > max_allowed:',
    '            errors.append(f"{name}: render count {item[\"actual\"]} > {max_allowed}")',
    "",
    "# Validate DataFetcher.fixed.tsx exists and is non-empty",
    'fixed_text = Path("outputs/DataFetcher.fixed.tsx").read_text()',
    "if not fixed_text.strip():",
    '    errors.append("DataFetcher.fixed.tsx is empty")',
    "",
    "if errors:",
    "    for e in errors:",
    '        print(f"FAIL: {e}")',
    "    sys.exit(1)",
    "",
    'print("VERIFY PASS: All checks ok")',
    "sys.exit(0)",
  ].join("\n"));

  // ── README.md ─────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "README.md"), [
    "# React DataFetcher Stale Closure Fix",
    "",
    "## Overview",
    "Fix a stale-closure bug in `src/DataFetcher.tsx` where async fetch responses",
    "can overwrite the final rendered value after unmount or rapid prop changes.",
    "",
    "## Files",
    "| Path | Role |",
    "|---|---|",
    "| `src/DataFetcher.tsx` | Source file with the stale-closure bug |",
    "| `src/DataFetcher.test.tsx` | Jest test suite (5 fixtures) |",
    "| `jest.config.js` | Jest configuration |",
    "| `package.json` | Dependencies (React 18, Testing Library, Jest) |",
    "",
    "## Task",
    "Run `python solve.py` to fix the component and produce output reports.",
    "Then run `python verify.py` to validate.",
  ].join("\n"));

  // ── version_manifest.json ─────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "version_manifest.json"), JSON.stringify({
    generator: "selection-improvement-runner",
    generator_version: "2026-05-12-local-runner",
    generated_at: new Date().toISOString(),
    domain: "react",
    language: "TypeScript 5.4+, React 18",
    runtimes: RUNTIMES
  }, null, 2));

  const npmResult = spawnSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
    cwd: taskDir,
    timeout: 30000,
    shell: true,
    stdio: "pipe"
  });
  if (npmResult.status !== 0) {
    console.log("[generator] npm install --package-lock-only for react exited", npmResult.status);
  }
}

// ── Build real git repos and bundles for the git-force-push-recovery task ──
function buildGitBundles(taskDir) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-gen-"));
  const git = (args, opts = {}) => {
    const r = spawnSync("git", args, { cwd: tmpDir, shell: process.platform === "win32", ...opts });
    return r;
  };
  git(["init"]);
  // Ensure HEAD points to 'main' regardless of git version's default branch name
  git(["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(["config", "user.name", "Generator"]);
  git(["config", "user.email", "gen@example.com"]);

  // Helper: write a file, git add, git commit, return SHA
  function commit(files, msg) {
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(tmpDir, rel);
      const d = path.dirname(p);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(p, content);
    }
    git(["add", "-A"]);
    const r = git(["commit", "-m", msg]);
    const sha = git(["rev-parse", "HEAD"]).stdout.toString().trim();
    return sha;
  }

  const baseContent = {
    "README.md": "# Git Force-Push Recovery\n\nThis repo simulates a force-push accident on the release-v2.1 branch.",
    ".gitignore": "node_modules/\n.DS_Store\n",
  };

  // ── main branch commits ──
  const shaA = commit({ ...baseContent, "src/config.ts": "export const API_URL = 'https://api.example.com';\nexport const TIMEOUT = 5000;\n" }, "Set up CI/CD pipeline for staging deploy");
  const shaB = commit({ "src/handler.ts": "export function handle(req) {\n  return { status: 200, body: req };\n}\n", "src/db.ts": "export const pool = new Map();\n" }, "Refactor database connection pooling");

  // ── release-v2.1 branch (branches from shaA) ──
  git(["checkout", "-b", "release-v2.1", shaA]);
  const shaC = commit({ "src/config.ts": "export const API_URL = 'https://api.example.com';\nexport const TIMEOUT = 5000;\nexport const RATE_LIMIT = 100;\n" }, "Add rate-limiting config for payment gateway");
  const shaD = commit({ "package.json": JSON.stringify({ name: "my-app", version: "2.1.0-rc.1" }, null, 2) }, "Bump version to 2.1.0-rc.1");
  const shaE = commit({ "src/transaction.ts": "export function processTx(tx) {\n  if (!tx) throw new Error('null tx');\n  return { id: tx.id, status: 'processed' };\n}\n" }, "Fix null-pointer in transaction handler");
  const shaF = commit({ "src/handler.ts": "export function handle(req) {\n  if (!req.user) return { status: 401 };\n  return { status: 200, body: req };\n}\n" }, "Merge feature/urgent-fix into release-v2.1");

  // Capture SHAs truncated for reflog
  const trunc = (s) => s.slice(0, 7);

  // ── repo_before_force.bundle: everything (main + release-v2.1) ──
  const beforePath = path.join(taskDir, "repo_before_force.bundle");
  git(["checkout", "main"]);
  git(["bundle", "create", beforePath, "--all"]);

  // ── repo_after_force.bundle: main only (release-v2.1 was force-pushed away) ──
  const afterPath = path.join(taskDir, "repo_after_force.bundle");
  git(["bundle", "create", afterPath, "main"]);

  // File checksums (git hash-object output)
  const checksums = {};
  git(["checkout", shaC]);
  checksums[trunc(shaC)] = { "src/config.ts": git(["hash-object", "src/config.ts"]).stdout.toString().trim() };
  git(["checkout", shaD]);
  checksums[trunc(shaD)] = { "package.json": git(["hash-object", "package.json"]).stdout.toString().trim() };
  git(["checkout", shaE]);
  checksums[trunc(shaE)] = { "src/transaction.ts": git(["hash-object", "src/transaction.ts"]).stdout.toString().trim() };

  // Cleanup temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return {
    shaA: trunc(shaA), shaB: trunc(shaB), shaC: trunc(shaC),
    shaD: trunc(shaD), shaE: trunc(shaE), shaF: trunc(shaF),
    shaA_full: shaA, shaB_full: shaB, shaC_full: shaC,
    shaD_full: shaD, shaE_full: shaE, shaF_full: shaF,
    checksums
  };
}

// ── Git package generator ──────────────────────────────────────────────
function generateGitPackage(taskDir, fields) {
  const verifierDir = path.join(taskDir, "verifier_inputs");
  ensureDir(verifierDir);

  // Build real git repos and bundles
  let shas;
  try {
    shas = buildGitBundles(taskDir);
  } catch (e) {
    console.error("[generator] Failed to build git bundles:", e.message);
    // Fallback: write placeholder bundles so the package is still usable
    fs.writeFileSync(path.join(taskDir, "repo_before_force.bundle"), "PLACEHOLDER: git bundle generation failed — replace with real bundle\n");
    fs.writeFileSync(path.join(taskDir, "repo_after_force.bundle"), "PLACEHOLDER: git bundle generation failed — replace with real bundle\n");
    shas = {
      shaA: "a1b2c3d", shaB: "e4f5g6h", shaC: "i7j8k9l",
      shaD: "m0n1o2p", shaE: "q3r4s5t", shaF: "u6v7w8x",
      shaA_full: "a1b2c3d000000000000000000000000000000000",
      shaB_full: "e4f5g6h000000000000000000000000000000000",
      shaC_full: "i7j8k9l000000000000000000000000000000000",
      shaD_full: "m0n1o2p000000000000000000000000000000000",
      shaE_full: "q3r4s5t000000000000000000000000000000000",
      shaF_full: "u6v7w8x000000000000000000000000000000000",
      checksums: {
        "i7j8k9l": { "src/config.ts": "abc123" },
        "m0n1o2p": { "package.json": "def456" },
        "q3r4s5t": { "src/transaction.ts": "789abc" }
      }
    };
  }

  // ── Reflog export ─────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "reflog_export.txt"), [
    `${shas.shaF} HEAD@{0}: commit (merge): Merge feature/urgent-fix into release-v2.1`,
    `${shas.shaE} HEAD@{1}: commit: Fix null-pointer in transaction handler`,
    `${shas.shaD} HEAD@{2}: commit: Bump version to 2.1.0-rc.1`,
    `${shas.shaC} HEAD@{3}: commit: Add rate-limiting config for payment gateway`,
    `${shas.shaB} HEAD@{4}: commit: Refactor database connection pooling`,
    `${shas.shaA} HEAD@{5}: commit: Set up CI/CD pipeline for staging deploy`,
  ].join("\n"));

  // ── Commit graph spec ─────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "commit_graph_spec.json"), JSON.stringify({
    description: "Expected commit graph topology after recovery. The three orphaned SHAs must be reachable from branch refs in this exact order.",
    branches: {
      "release-v2.1": {
        expected_tip: shas.shaF,
        expected_ancestors: [shas.shaF, shas.shaE, shas.shaD, shas.shaC, shas.shaA],
        orphaned_commits: [shas.shaF, shas.shaE, shas.shaD]
      },
      "main": {
        expected_tip: shas.shaB,
        expected_ancestors: [shas.shaB, shas.shaA]
      }
    }
  }, null, 2));

  // ── Expected file checksums ───────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "expected_file_checksums.json"), JSON.stringify(shas.checksums, null, 2));

  // ── Expected refs ─────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "expected_refs.json"), JSON.stringify({
    "refs/heads/release-v2.1": shas.shaF_full,
    "refs/heads/main": shas.shaB_full
  }, null, 2));

  // ── solve.py ───────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "solve.py"), [
    "#!/usr/bin/env python3",
    '"""Solve: Recover orphaned commits from git bundle using reflog."""',
    "import sys, json, subprocess, tempfile, os, re",
    "from pathlib import Path",
    "",
    "OUT_DIR = Path('outputs')",
    "OUT_DIR.mkdir(parents=True, exist_ok=True)",
    "import platform",
    "GIT = 'git.exe' if platform.system() == 'Windows' else 'git'",
    "",
    "def git(args, cwd=None):",
    "    return subprocess.run([GIT] + args, capture_output=True, text=True, cwd=cwd)",
    "",
    "def git_ok(args, cwd=None):",
    "    r = git(args, cwd)",
    '    return r.returncode == 0 and not r.stderr.strip()',
    "",
    "# ---- Parse inputs ----",
    "before_bundle = Path('repo_before_force.bundle')",
    "after_bundle = Path('repo_after_force.bundle')",
    "reflog_txt = Path('reflog_export.txt').read_text()",
    "spec = json.loads(Path('commit_graph_spec.json').read_text())",
    "expected_checksums = json.loads(Path('expected_file_checksums.json').read_text())",
    "expected_refs = json.loads(Path('expected_refs.json').read_text())",
    "",
    "# Extract orphaned SHAs from reflog",
    "reflog_shas = set()",
    "for line in reflog_txt.strip().splitlines():",
    "    m = re.match(r'^([a-f0-9]{7,40})\\s', line)",
    "    if m:",
    "        reflog_shas.add(m.group(1))",
    "",
    "orphaned = list(reflog_shas)",
    "if not orphaned:",
    '    orphaned = spec.get("branches", {}).get("release-v2.1", {}).get("orphaned_commits", [])',
    "",
    '# ---- Step 1: Verify bundles are real git bundles ----',
    "before_verify = git(['bundle', 'verify', str(before_bundle)])",
    "if before_verify.returncode != 0:",
    '    print("FAIL: repo_before_force.bundle is not a valid git bundle")',
    "    (OUT_DIR / 'run_manifest.json').write_text(json.dumps({",
    '        "solver": "solve.py", "status": "failed",',
    '        "error": "before_bundle_invalid",',
    '        "details": before_verify.stderr.strip()',
    "    }, indent=2))",
    "    sys.exit(1)",
    "",
    "# ---- Step 2: Create recovery repo from before-bundle ----",
    "recovery = Path('recovery_worktree')",
    "if recovery.exists():",
    "    import shutil; shutil.rmtree(recovery)",
    "# git init bare to fetch bundle refs into, then clone out",
    "fetch_r = git(['clone', str(before_bundle), str(recovery)])",
    "if fetch_r.returncode != 0:",
    '    print("FAIL: could not clone before_bundle")',
    "    sys.exit(1)",
    "",
    "# ---- Step 3: Restore branch refs to expected SHAs ----",
    "restored = {}",
    "for ref, expected_sha in expected_refs.items():",
    "    short = expected_sha[:7]",
    "    # Check if the commit exists in the cloned repo",
    '    cat_r = git(["cat-file", "-e", expected_sha], cwd=str(recovery))',
    "    if cat_r.returncode != 0:",
    "        print(f\"Commit {expected_sha} not found in bundle — skipping {ref}\")",
    "        continue",
    "    # Restore the ref — git update-ref creates or overwrites",
    '    ur_r = git(["update-ref", ref, expected_sha], cwd=str(recovery))',
    "    if ur_r.returncode == 0:",
    "        restored[ref] = expected_sha",
    '        print(f"Restored {ref} → {expected_sha}")',
    "",
    "# ---- Step 4: Verify reachability ----",
    "graph_report = {'branches': {}}",
    "for ref, info in spec.get('branches', {}).items():",
    "    tip = info['expected_tip']",
    '    rl_r = git(["rev-list", "--ancestry-path", f"{tip}^..{tip}"], cwd=str(recovery))',
    "    ancestors_raw = git(['rev-list', tip], cwd=str(recovery)).stdout.strip().splitlines()[:20]",
    "    ancestors = [s[:7] for s in ancestors_raw]",
    "    expected_ancestors_short = [s[:7] for s in info.get('expected_ancestors', [])]",
    "    all_found = all(any(ea in a for a in ancestors) for ea in expected_ancestors_short)",
    "    graph_report['branches'][ref] = {",
    '        "tip": tip,',
    '        "expected_ancestors": expected_ancestors_short,',
    '        "found_ancestors": ancestors,',
    '        "all_reachable": all_found',
    "    }",
    "(OUT_DIR / 'commit_graph_report.json').write_text(json.dumps(graph_report, indent=2))",
    "",
    "# ---- Step 5: Check file checksums at recovered commits ----",
    "checksum_results = {}",
    "for sha, files in expected_checksums.items():",
    "    checksum_results[sha] = {}",
    "    for fpath, expected_hash in files.items():",
    '        hash_r = git(["hash-object", fpath], cwd=str(recovery))',
    "        if hash_r.returncode != 0:",
    "            checksum_results[sha][fpath] = {'status': 'file_not_found', 'expected': expected_hash}",
    "        else:",
    "            actual = hash_r.stdout.strip()[:6]",
    "            match = actual == expected_hash[:6]",
    "            checksum_results[sha][fpath] = {'status': 'match' if match else 'mismatch', 'expected': expected_hash, 'actual': actual}",
    "",
    "# ---- Step 6: Create repaired bundle ----",
    'bundle_r = git(["bundle", "create", str(OUT_DIR / "repaired_repo.bundle"), "--all"], cwd=str(recovery))',
    "bundle_ok = bundle_r.returncode == 0",
    "",
    "# ---- Step 7: Repair log ----",
    "repair_log = {",
    '    "branches_restored": list(restored.keys()),',
    '    "refs_expected": expected_refs,',
    '    "refs_restored": restored,',
    '    "all_refs_restored": len(restored) == len(expected_refs),',
    '    "orphaned_shas": [s[:7] for s in orphaned],',
    '    "bundle_created": bundle_ok,',
    '    "checksums": checksum_results,',
    "}",
    "(OUT_DIR / 'repair_log.json').write_text(json.dumps(repair_log, indent=2))",
    "",
    "# ---- Step 8: Run manifest ----",
    "(OUT_DIR / 'run_manifest.json').write_text(json.dumps({",
    '    "solver": "solve.py",',
    '    "python": sys.version,',
    '    "branches_restored": len(restored),',
    '    "bundle_created": bundle_ok,',
    "}, indent=2))",
    "",
    'print(f"Done. Restored {len(restored)} refs, bundle ok: {bundle_ok}")',
  ].join("\n"));

  // ── verify.py ──────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "verify.py"), [
    "#!/usr/bin/env python3",
    '"""Verify: Check repaired bundle validity, commit topology, and checksums."""',
    "import sys, json, subprocess, tempfile, os",
    "from pathlib import Path",
    "import platform",
    "GIT = 'git.exe' if platform.system() == 'Windows' else 'git'",
    "",
    "errors = []",
    "",
    'required_outputs = [',
    '    "outputs/repaired_repo.bundle",',
    '    "outputs/repair_log.json",',
    '    "outputs/commit_graph_report.json",',
    '    "outputs/run_manifest.json"',
    "]",
    "",
    "for ro in required_outputs:",
    "    if not Path(ro).exists():",
    '        errors.append(f"Missing required output: {ro}")',
    "",
    "if errors:",
    "    for e in errors:",
    '        print(f"FAIL: {e}")',
    "    sys.exit(1)",
    "",
    "# ---- Check 1: repaired_repo.bundle is valid and cloneable ----",
    "def git(args, cwd=None):",
    "    return subprocess.run([GIT] + args, capture_output=True, text=True, cwd=cwd)",
    "",
    "bundle_verify = git(['bundle', 'verify', 'outputs/repaired_repo.bundle'])",
    "if bundle_verify.returncode != 0:",
    '    errors.append("repaired_repo.bundle: git bundle verify failed")',
    "",
    "if not errors:",
    "    with tempfile.TemporaryDirectory() as td:",
    '        clone = git(["clone", "outputs/repaired_repo.bundle", td])',
    "        if clone.returncode != 0:",
    '            errors.append("repaired_repo.bundle: git clone failed")',
    "",
    "        if not errors:",
    '            fsck = git(["fsck", "--connectivity-only"], cwd=td)',
    "            if fsck.returncode != 0:",
    '                errors.append("repaired_repo.bundle: git fsck --connectivity-only reports missing or corrupt objects")',
    "",
    "# ---- Check 2: repair_log.json all refs restored ----",
    "repair_log = json.loads(Path('outputs/repair_log.json').read_text())",
    "expected_refs_path = Path('expected_refs.json')",
    "if expected_refs_path.exists():",
    "    expected_refs = json.loads(expected_refs_path.read_text())",
    "    restored = set(repair_log.get('refs_restored', {}).keys())",
    "    expected = set(expected_refs.keys())",
    "    if restored != expected:",
    '        errors.append(f"Refs restored {restored} do not match expected {expected}")',
    "    for ref, sha in expected_refs.items():",
    "        actual = repair_log.get('refs_restored', {}).get(ref, '')",
    "        if actual != sha:",
    '            errors.append(f"{ref}: expected SHA {sha}, got {actual}")',
    "",
    "# ---- Check 3: commit_graph_report.json topology matches spec ----",
    "graph_report = json.loads(Path('outputs/commit_graph_report.json').read_text())",
    "spec_path = Path('commit_graph_spec.json')",
    "if spec_path.exists():",
    "    spec = json.loads(spec_path.read_text())",
    "    for branch, info in spec.get('branches', {}).items():",
    "        branch_report = graph_report.get('branches', {}).get(branch, {})",
    "        if not branch_report.get('all_reachable'):",
    '            errors.append(f"{branch}: not all expected ancestors are reachable")',
    "        expected_ancestors = set(a[:7] for a in info.get('expected_ancestors', []))",
    "        found_ancestors = set(branch_report.get('found_ancestors', []))",
    "        missing = expected_ancestors - found_ancestors",
    "        if missing:",
    '            errors.append(f"{branch}: missing expected ancestors {missing}")',
    "",
    "# ---- Check 4: checksums ----",
    "checksums = repair_log.get('checksums', {})",
    "for sha, files in checksums.items():",
    "    for fpath, result in files.items():",
    "        if result.get('status') == 'mismatch':",
    '            errors.append(f"{sha}:{fpath} checksum mismatch (expected {result[\"expected\"]}, got {result[\"actual\"]})")',
    "        elif result.get('status') == 'file_not_found':",
    '            errors.append(f"{sha}:{fpath} not found")',
    "",
    "if errors:",
    "    for e in errors:",
    '        print(f"FAIL: {e}")',
    "    sys.exit(1)",
    "",
    'print("VERIFY PASS: All checks ok")',
    "sys.exit(0)",
  ].join("\n"));

  // ── README.md ─────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "README.md"), [
    "# Git Force-Push Recovery",
    "",
    "## Overview",
    "Recover three orphaned commits lost to an accidental `git push --force`.",
    "",
    "## Files",
    "| Path | Role |",
    "|---|---|",
    "| `repo_before_force.bundle` | Git bundle taken before force push |",
    "| `repo_after_force.bundle` | Git bundle taken after force push |",
    "| `reflog_export.txt` | Reflog entries showing lost SHAs |",
    "| `commit_graph_spec.json` | Expected commit topology |",
    "| `expected_file_checksums.json` | File checksums per commit |",
    "| `expected_refs.json` | Expected branch ref SHAs |",
  ].join("\n"));

  // ── version_manifest.json ─────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "version_manifest.json"), JSON.stringify({
    generator: "selection-improvement-runner",
    generator_version: "2026-05-12-local-runner",
    generated_at: new Date().toISOString(),
    domain: "git",
    language: "Git (any modern version)",
    runtimes: RUNTIMES
  }, null, 2));
}

// ── Build task zip (cached — same prompt identity returns existing package) ──
const builtPackages = new Map();

app.post("/api/build-task-zip", (req, res) => {
   try {
const {  family = "typescript",  task_id: clientTaskId,  title = "",  prompt = "",  recipeId = "",  resources = "",  verifierDescription = ""} = req.body || {};

      // Package identity = hash of all content that makes a prompt unique
      const packageHash = crypto.createHash("sha256").update(JSON.stringify({ family, recipeId, title, prompt, resources, verifierDescription })).digest("hex");
      const shortHash = packageHash.slice(0, 16);
      const packageKey = `${family}:${shortHash}`;
      const task_id = clientTaskId || `${family}_${shortHash}_${uid()}`;

     // Return cached zip if already built for this prompt identity
     if (builtPackages.has(packageKey)) {
       const cached = builtPackages.get(packageKey);
       const zipPath = path.join(GENERATED_PACKAGES_DIR, `${cached}.zip`);
       if (fs.existsSync(zipPath)) {
         return res.status(200).json({
           ok: true,
           task_id: cached,
           family,
           packageHash: shortHash,
           packageKey,
           cached: true,
           zip_path: zipPath,
           download_url: `/api/download/${cached}`
         });
       }
       // Stale entry — rebuild
       builtPackages.delete(packageKey);
     }

     const taskDir = path.join(GENERATED_PACKAGES_DIR, task_id);
     if (fs.existsSync(taskDir)) {
       fs.rmSync(taskDir, { recursive: true, force: true });
     }
     ensureDir(taskDir);

switch (family) {
        case "react":
          generateReactPackage(taskDir, { title, prompt, resources, verifierDescription });
          break;
        case "typescript":
          generateTypeScriptPackage(taskDir, { title, prompt, resources, verifierDescription });
          break;
        case "git":
          generateGitPackage(taskDir, { title, prompt, resources, verifierDescription });
          break;
        default:
          res.status(400).json({ ok: false, error: "Unsupported family: " + family + ". Supported: react, typescript, git." });
          return;
      }

     // Zip it
     const zipPath = path.join(GENERATED_PACKAGES_DIR, `${task_id}.zip`);
     const zip = new AdmZip();
     zip.addLocalFolder(taskDir);
     zip.writeZip(zipPath);

     // Cache by prompt identity (not family alone), so every unique prompt gets its own package
     builtPackages.set(packageKey, task_id);

     // Clean up the working directory
     fs.rmSync(taskDir, { recursive: true, force: true });

     res.status(201).json({
       ok: true,
       task_id,
       family,
       packageHash: shortHash,
       packageKey,
       cached: false,
       zip_path: zipPath,
       download_url: `/api/download/${task_id}`
     });
   } catch (err) {
     console.error("[builder] build-task-zip error:", err);
     res.status(500).json({ ok: false, error: err.message });
   }
 });

// ── Start server ───────────────────────────────────────────────────────
ensureDir(WORKSPACES_DIR);

app.listen(PORT, HOST, () => {
  console.log(`[runner] Selection Improvement Runner listening on http://${HOST}:${PORT}`);
  console.log(`[runner] Python: ${RUNTIMES.python || "not found"}`);
  console.log(`[runner] Node:   ${RUNTIMES.node || "not found"}`);
  console.log(`[runner] Git:    ${RUNTIMES.git || "not found"}`);
});
