<div align="center">

# 🎯 Selection Improvement Experts

### A browser workspace for building stronger technical task submissions

Draft, check, package, and refine worker-side Selection Improvement Expert tasks against onboarding guidelines.

[![Live App](https://img.shields.io/badge/Live_App-Open_Workspace-0f766e?style=for-the-badge&logo=githubpages&logoColor=white)](https://dacameragirl.github.io/selection-improvement-experts/)
[![Static SPA](https://img.shields.io/badge/Frontend-Static_SPA-2563eb?style=for-the-badge&logo=html5&logoColor=white)](#-quick-start)
[![Local Storage](https://img.shields.io/badge/Data-Local_Only-7c3aed?style=for-the-badge&logo=databricks&logoColor=white)](#-privacy-first)

![JavaScript](https://img.shields.io/badge/JavaScript-App_Logic-F7DF1E?style=flat-square&logo=javascript&logoColor=000)
![HTML](https://img.shields.io/badge/HTML-Interface-E34F26?style=flat-square&logo=html5&logoColor=fff)
![Python](https://img.shields.io/badge/Python-Task_Verifiers-3776AB?style=flat-square&logo=python&logoColor=fff)
![CSS](https://img.shields.io/badge/CSS-Styling-1572B6?style=flat-square&logo=css3&logoColor=fff)
![PowerShell](https://img.shields.io/badge/PowerShell-Local_Tools-5391FE?style=flat-square&logo=powershell&logoColor=fff)

</div>

---

## ✨ What It Does

| Workspace | Purpose |
| --- | --- |
| 📚 **Guideline Library** | Stores onboarding notes by title and tags, extracts likely rules, and supports search. |
| 🛠️ **Prompt Maker** | Generates a draft package with a prompt, resources, golden solution, difficulty explanation, time estimate, verifiers, rubric, and optional agent difficulty check. |
| ✅ **Quality Gates** | Checks goal clarity, terminal requirements, realism, complete resources, deterministic verifiers, output-based grading, solvability, expertise depth, and other visible onboarding rules. |
| 🔎 **Question Helper** | Finds relevant saved rules for a pasted onboarding question and creates an answer outline. |
| 📦 **Task Packaging** | Supports local runner workflows for React, TypeScript, and Git recovery packages. |

Difficulty targets include **Senior professional**, **Master's level**, and **PhD / research level** across software engineering, computer science, databases, distributed systems, compilers, ML systems, applied math, statistics, scientific computing, and formal methods.

## 🚀 Quick Start

The browser app has zero frontend dependencies and needs no build step.

1. Clone or download this repository.
2. Open [`index.html`](index.html) directly in a browser.
3. Add guideline text to the Library.
4. Build and check drafts in Prompt Maker.
5. Export a JSON backup when needed.

For reliable local testing after meaningful code changes, serve the folder over `http://localhost`:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## 🧰 Language Toolkit

| Language | Role |
| --- | --- |
| ![JavaScript](https://img.shields.io/badge/-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=000) | Browser application logic, task generation, and local runner backend |
| ![HTML](https://img.shields.io/badge/-HTML5-E34F26?style=flat-square&logo=html5&logoColor=fff) | Static SPA entry point and inlined browser script |
| ![Python](https://img.shields.io/badge/-Python-3776AB?style=flat-square&logo=python&logoColor=fff) | Generated task solvers, verification scripts, and recovery tooling |
| ![CSS](https://img.shields.io/badge/-CSS3-1572B6?style=flat-square&logo=css3&logoColor=fff) | Workspace layout, visual states, and responsive styling |
| ![PowerShell](https://img.shields.io/badge/-PowerShell-5391FE?style=flat-square&logo=powershell&logoColor=fff) | Local startup and PDF extraction workflows |

## 📄 PDF Workflow

Private onboarding PDFs should stay out of git. This repository ignores PDFs and the `data/` folder by default.

To extract selectable text from a PDF into a local ignored file:

```powershell
New-Item -ItemType Directory -Path data -Force
node tools/extract-pdf-text.mjs "C:\Users\enter\Downloads\Selection_Improvement_Expert_Guidelines.pdf" > data\selection-improvement-experts.txt
```

Open the extracted text file, paste the guideline text into the Library, and save it as a guide. If the script reports that no selectable text was found, the PDF likely contains scanned images and needs OCR.

## ⚙️ Local Runner Backend

The optional [`backend/`](backend/) runner executes task packages locally:

```powershell
cd backend
npm install
npm start
```

The runner listens on `http://127.0.0.1:8787`. Upload a task ZIP, and it detects the task family, runs `solve.py` and `verify.py`, collects computed outputs, and populates the Final Answer field.

Git-workflow package generation uses a hardened contract. Worker resource ZIPs exclude `solve.py`, `verify.py`, `recovery_tool.py`, precomputed `outputs/`, and scratch worktrees. The verifier checks declared JSON schemas, exact ref topology, required checksum fixtures, reflog SHA ordering, manifest consistency, a real partial-overlap recovery case, corrupted-bundle rejection, and deterministic clean reruns.

## 🏆 Accepted Git Recovery Baseline

The Git force-push recovery task was refined across reviewer rounds and accepted with an **Excellent 5/5** result on **May 31, 2026**.

| Reference | Contents |
| --- | --- |
| [`RESUBMISSIONS/README_FIRST.md`](RESUBMISSIONS/README_FIRST.md) | Upload mapping and final handoff |
| [`RESUBMISSIONS/OUTLIER_FORM_TEXT_AND_CHECKLIST.md`](RESUBMISSIONS/OUTLIER_FORM_TEXT_AND_CHECKLIST.md) | Paste-ready form fields and checklist |
| [`docs/GIT_FORCE_PUSH_RECOVERY_REVISION_HISTORY.md`](docs/GIT_FORCE_PUSH_RECOVERY_REVISION_HISTORY.md) | Reviewer findings and corresponding fixes |
| [`docs/reviewer-feedback/`](docs/reviewer-feedback/README.md) | Verbatim reviewer feedback archive |
| [`docs/accepted-submissions/`](docs/accepted-submissions/README.md) | Accepted baseline index and audit evidence |

## 🔐 Privacy First

- Browser data stays in local storage under `selection-improvement-experts-v1`.
- The static site has no backend requirement.
- Private PDFs and extracted guideline text are ignored by git.
- The runner backend stays local and is not deployed with the static app.

## 🌐 Deployment

The repository includes [`vercel.json`](vercel.json) for static deployment on Vercel. GitHub Pages can also host the browser app.

1. Push the repository to GitHub.
2. Import it in the Vercel dashboard, or enable GitHub Pages.
3. Leave the build command empty.
4. Keep the optional runner backend local-only.

---

<div align="center">

### 🧭 Build clear tasks. Verify concrete outputs. Keep private data local.

[Open the workspace](https://dacameragirl.github.io/selection-improvement-experts/) · [Read the resubmission handoff](RESUBMISSIONS/README_FIRST.md) · [Review the accepted baseline](docs/accepted-submissions/README.md)

</div>
