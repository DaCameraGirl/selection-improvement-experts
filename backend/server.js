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
function generateTypeScriptPackage(taskDir) {
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
    fs.writeFileSync(path.join(typeTestsDir, name), `// @ts-expect-error — this file intentionally tests a buggy type\n${content}`);
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
      "type_tests/invalid_non_thenable.ts": { errors: 0 }
    },
    total_passing: 5,
    total_failing: 0
  }, null, 2));

  // ── Output schemas ────────────────────────────────────────────────────
  fs.writeFileSync(path.join(outputSchemasDir, "typecheck_results.schema.json"), JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      summary: {
        type: "object",
        properties: {
          total_files: { type: "integer" },
          passing_files: { type: "integer" },
          failing_files: { type: "integer" },
          all_pass: { type: "boolean" }
        },
        required: ["total_files", "passing_files", "failing_files", "all_pass"]
      },
      file_results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: { type: "string" },
            errors: { type: "integer" },
            passed: { type: "boolean" }
          },
          required: ["file", "errors", "passed"]
        }
      },
      diagnostics_log: { type: "string" }
    },
    required: ["summary", "file_results"]
  }, null, 2));

  // ── solve.py ───────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(taskDir, "solve.py"), [
    "#!/usr/bin/env python3",
    '"""Solve: Fix AwaitedLike<T> conditional type, run tsc --noEmit on all test files, report results."""',
    "import sys, json, subprocess, re, hashlib, os",
    "from pathlib import Path",
    "",
    "OUT_DIR = Path(\"outputs\")",
    "OUT_DIR.mkdir(parents=True, exist_ok=True)",
    "",
    "def run(args, cwd=None):",
    '    return subprocess.run(args, capture_output=True, text=True, cwd=cwd)',
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
    "# ---- Step 2: Run tsc --noEmit on each test file ----",
    "test_files = sorted(Path(\"type_tests\").glob(\"*.ts\"))",
    "file_results = []",
    "all_pass = True",
    "",
    "for tf in test_files:",
    "    r = run([\"npx\", \"tsc\", \"--noEmit\", \"--pretty\", \"false\", str(tf)])",
    "    errors = len(re.findall(r\"error TS\\d+\", r.stdout + r.stderr))",
    "    passed = errors == 0",
    "    file_results.append({",
    '        "file": str(tf),',
    '        "errors": errors,',
    '        "passed": passed',
    "    })",
    "    if not passed:",
    "        all_pass = False",
    "",
    "# ---- Step 3: Write output files ----",
    "report = {",
    '    "summary": {',
    '        "total_files": len(file_results),',
    '        "passing_files": sum(1 for f in file_results if f["passed"]),',
    '        "failing_files": sum(1 for f in file_results if not f["passed"]),',
    '        "all_pass": all_pass',
    "    },",
    '    "file_results": file_results,',
    '    "diagnostics_log": ""',
    "}",
    "",
    "(OUT_DIR / \"typecheck_results.json\").write_text(json.dumps(report, indent=2))",
    "(OUT_DIR / \"fix_applied.json\").write_text(json.dumps({",
    '    "file": "src/utils/awaited_util.ts",',
    '    "original_sha256": sha256_of(util_path) if Path(util_path).exists() else "",',
    '    "fixed": True',
    "}, indent=2))",
    "(OUT_DIR / \"run_manifest.json\").write_text(json.dumps({",
    '    "solver": "solve.py",',
    '    "python": sys.version,',
    '    "files_checked": len(file_results),',
    '    "all_pass": all_pass',
    "}, indent=2))",
    "",
    "print(f\"Done. Files checked: {len(file_results)}, all pass: {all_pass}\")",
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
    '    "outputs/typecheck_results.json",',
    '    "outputs/fix_applied.json",',
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
    "# Validate typecheck_results schema",
    "results = json.loads(Path(\"outputs/typecheck_results.json\").read_text())",
    'if "summary" not in results:',
    '    errors.append("typecheck_results missing summary")',
    "else:",
    "    s = results[\"summary\"]",
    "    for k in [\"total_files\", \"passing_files\", \"failing_files\", \"all_pass\"]:",
    "        if k not in s:",
    "            errors.append(f\"summary missing {k}\")",
    "",
    "    # Expect all 5 test files to pass after fix",
    "    expected = json.loads(Path(\"verifier_inputs/expected_diagnostics.json\").read_text())",
    '    expected_pass = expected.get("passes_after_fix", {})',
    "    for fr in results.get(\"file_results\", []):",
    "        fname = fr[\"file\"]",
    "        if fname in expected_pass and fr[\"errors\"] != expected_pass[fname][\"errors\"]:",
    "            errors.append(f\"{fname}: expected {expected_pass[fname]['errors']} errors, got {fr['errors']}\")",
    "",
    "# Validate fix_applied",
    "fix_info = json.loads(Path(\"outputs/fix_applied.json\").read_text())",
    'if not fix_info.get("fixed"):',
    '    errors.append("Fix was not applied")',
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
}

// ── Build task zip ──────────────────────────────────────────────────────
app.post("/api/build-task-zip", (req, res) => {
  try {
    const { family = "typescript", task_id = uid() } = req.body || {};
    const taskDir = path.join(GENERATED_PACKAGES_DIR, task_id);
    if (fs.existsSync(taskDir)) {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
    ensureDir(taskDir);

    switch (family) {
      case "typescript":
        generateTypeScriptPackage(taskDir);
        break;
      default:
        res.status(400).json({ ok: false, error: `Unsupported family: ${family}` });
        return;
    }

    // Zip it
    const zipPath = path.join(GENERATED_PACKAGES_DIR, `${task_id}.zip`);
    const zip = new AdmZip();
    zip.addLocalFolder(taskDir);
    zip.writeZip(zipPath);

    // Clean up the working directory
    fs.rmSync(taskDir, { recursive: true, force: true });

    res.status(201).json({
      ok: true,
      task_id,
      family,
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
