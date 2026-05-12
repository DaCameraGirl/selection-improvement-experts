# AGENTS.md — selection-improvement-experts

## What this is

Static browser-only SPA (HTML + CSS + JS, zero deps, no build/server).  
A task-submission builder for Outlier TBench "Selection Improvement Expert" guidelines.

## Commands

```powershell
# Extract selectable text from a private onboarding PDF (output goes to gitignored data/)
node tools/extract-pdf-text.mjs "path\to.pdf" > data\selection-improvement-experts.txt
```

```powershell
# Re-inline app.js into index.html after editing app.js
node tools/inline-js.mjs
```

No package install, no test runner, no lint/typecheck — nothing else to run.

## Key files

| Path | Role |
|---|---|
| `index.html` | Entry point — open in browser directly |
| `app.js` | All app logic (~6900 lines, single file) |
| `styles.css` | All styles |
| `tools/extract-pdf-text.mjs` | Node.js PDF text extractor (needs no deps) |

## Cache-busting

JS is inlined directly into `index.html` (no external script tag) — this avoids the stale `app-latest.js` cache but `index.html` itself still gets cached by file:// origin.

**When editing JS:** update `APP_VERSION` inside `index.html` (search `APP_VERSION = "…"`), then re-inline the JS content from `app.js` into `index.html`.

**To test reliably (bypass file:// cache entirely):**
```powershell
# Serve locally and open http://localhost:8000
python -m http.server 8000
```
Or use VS Code Live Server extension. Always test via `http://localhost` not `file://` after meaningful changes.

## Storage

Browser `localStorage` key: `selection-improvement-experts-v1`.  
No server, no backend — data is local-only.

## Git conventions

- `.gitignore` covers `data/`, `*.pdf`, `*.local.json` — onboarding PDFs stay out of version control
- No lockfiles, no CI, no test framework — pure static site
- The `tools/` script uses zero npm deps (Node built-ins only)

## Notable architecture

- App version constant on `app.js:5` — update on meaningful changes
- DOM element refs collected once in `els` object (`app.js:13-60`)
- Single `state` object (`app.js:7-11`) drives all views
- CSS state classes: `.is-active`, `.is-visible`, `.is-hidden`
- Template-driven card rendering via `<template id="guide-card-template">` in `index.html:321`
- JSZip loaded from CDN (`index.html:341`) — only used for ZIP download feature

## Domain-override architecture

Each domain in `DOMAIN_DETAILS` (TypeScript line 3855, React line 4013, Git-workflows line 4162) can supply:
- `domainLabel` — overrides the generic `${scenario.name} task in ${profile.domain}` fallback
- `difficultyDraft(efLabel, profile, scenario)` — overrides the generic scenario-aware difficulty text
- `verifierIntro` — overrides the scenario-derived verifier description

React and Git PhD selections are capped to "master's level" for display, domain field, and checklist depth checks — the `phdCappedDomains` set controls this.

Resource headings use domain-neutral labels: "Task evidence files:", "Required deliverables:", "Verifier test cases:".
