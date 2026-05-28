# Selection Improvement Experts

A local browser workspace for building worker-side Selection Improvement Expert task submissions against the onboarding guidelines.

Open `index.html` in a browser. The app saves data in browser local storage and can export/import a JSON backup.

## What it does

- Stores onboarding guideline notes by title and tags.
- Extracts likely rules from bullets, numbered lists, and policy wording.
- Searches saved guidelines.
- Provides a Prompt Maker that generates and formats a draft task package with prompt, resources, golden solution, difficulty explanation, time estimate, verifiers, a submission rubric, and optional agent difficulty check.
- Supports Senior professional, Master's level, and PhD / research level targets across multiple technical domains, including software engineering, computer science, databases, distributed systems, compilers, ML systems, applied math, statistics, scientific computing, and formal methods.
- Checks the draft against the visible onboarding rules: computer/terminal requirement, final goal upfront, goal-not-process wording, no persona framing, no GUI-only workflow, not-just-reasoning, real-world source inspiration, non-contrived task design, concrete output, complete environment, resource bundle clarity, deterministic verifiers, output-based grading, solvability, difficulty, expertise depth, specialized method, and domain expertise.
- Finds relevant rules for a pasted onboarding question and creates an answer outline.

## PDF workflow

Private onboarding PDFs should stay out of git. This repo ignores PDFs and the `data/` folder by default.

To extract selectable text from a PDF into a local ignored file:

```powershell
New-Item -ItemType Directory -Path data -Force
node tools/extract-pdf-text.mjs "C:\Users\enter\Downloads\Selection_Improvement_Expert_Guidelines.pdf" > data\selection-improvement-experts.txt
```

Then open the text file, paste the extracted guideline text into the Library, and save it as a guide.

If the script says no selectable text was found, the PDF is probably scanned images and needs OCR.

## Local Runner Backend

The `backend/` directory contains an Express.js server that executes task packages locally:

```powershell
cd backend
npm install
npm start
```

The runner listens on `http://127.0.0.1:8787`. Upload a task ZIP, and the runner detects the task family (React / TypeScript / Git-workflows), runs `solve.py` and `verify.py`, collects computed outputs, and populates the Final Answer field.

Git-workflow package generation uses a hardened contract: worker-facing resource ZIPs exclude `solve.py`, `verify.py`, precomputed `outputs/`, and scratch worktrees. The generated verifier checks the declared JSON schemas, exact ref topology, required checksum fixtures, reflog SHA ordering, manifest consistency, and deterministic reruns.

## Vercel Deployment

The app includes `vercel.json` for static deployment on Vercel. To deploy:

1. Push the repo to GitHub (private repo recommended)
2. Import the repo in Vercel dashboard
3. Vercel auto-detects the static SPA — no build command needed
4. The runner backend is NOT deployed (local-only). The prompt builder and all quality gates work fully as a static site.

To make the GitHub repo private:
- Go to repo Settings → Danger Zone → Change visibility → Make private

## Repo notes

This app is intentionally dependency-free: no build step, no server, and no package install. The browser stores your guideline library locally.

Use it to draft and check your own task submissions against the official rules.
