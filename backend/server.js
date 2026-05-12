const express = require("express");
const { execFile, spawn } = require("child_process");
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
const packages = new Map();   // package_id -> { workspace, files, family, ... }
const runs = new Map();       // run_id -> { status, logs, outputs, ... }

// ── Detect available runtimes ──────────────────────────────────────────
function detectRuntimes() {
  const results = { python: null, node: null, git: null };
  const checks = [
    { name: "python", cmd: "python", args: ["--version"] },
    { name: "node",   cmd: "node",   args: ["--version"] },
    { name: "git",    cmd: "git",    args: ["--version"] },
  ];
  for (const check of checks) {
    try {
      const out = execFile(check.cmd, check.args, { timeout: 5000 });
      results[check.name] = out.stdout ? out.stdout.trim() : (out.stderr ? out.stderr.trim() : "");
      // Python --version writes to stderr on some platforms
      if (!results[check.name] && out.stderr) results[check.name] = out.stderr.trim();
    } catch {
      results[check.name] = null;
    }
  }
  return results;
}

// ── Synchronous runtime detection at startup ──────────────────────────
function detectRuntimesSync() {
  const results = { python: null, node: null, git: null };
  const checks = [
    { name: "python", cmd: "python", args: ["--version"] },
    { name: "node",   cmd: "node",   args: ["--version"] },
    { name: "git",    cmd: "git",    args: ["--version"] },
  ];
  for (const check of checks) {
    try {
      const buf = require("child_process").execFileSync(check.cmd, check.args, { timeout: 5000 });
      const out = (buf.stdout || buf.stderr || buf || "").toString().trim();
      results[check.name] = out;
    } catch {
      results[check.name] = null;
    }
  }
  return results;
}

const RUNTIMES = detectRuntimesSync();

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

// ── Start server ───────────────────────────────────────────────────────
if (!fs.existsSync(WORKSPACES_DIR)) {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

app.listen(PORT, HOST, () => {
  console.log(`[runner] Selection Improvement Runner listening on http://${HOST}:${PORT}`);
  console.log(`[runner] Python: ${RUNTIMES.python || "not found"}`);
  console.log(`[runner] Node:   ${RUNTIMES.node || "not found"}`);
  console.log(`[runner] Git:    ${RUNTIMES.git || "not found"}`);
});
