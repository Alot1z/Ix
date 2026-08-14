# Prompt: ix-session-startup

Purpose
-------
Run at the start of every Ix-remap engineering session. Establishes live
state context and orients the orchestrator before any work begins.

Usage
-----
Invoke first when a session begins or resumes. Feeds output into
ix-orchestrator for scoping decisions.

Sequence
--------
1. `git fetch origin upstream && git fetch origin fork`
2. Recompute fork comparison:
   `git rev-parse origin/upstream/main`, `git rev-parse origin/fork/main`,
   `git merge-base origin/upstream/main origin/fork/main`,
   `git rev-list --left-right --count origin/upstream/main...origin/fork/main`
3. Inspect changed files:
   `git diff --stat origin/upstream/main...HEAD`
4. Record in `planning/AI-ENGINEERING-STATE.md` `## Session <timestamp>` block:
   - upstream/main SHA
   - fork/main SHA
   - merge-base
   - ahead/behind
   - changed file list
5. Fetch live GitHub state:
   `gh pr list --repo ix-infrastructure/Ix --state open`
   `gh issue list --repo ix-infrastructure/Ix --state open`
6. Diff this fresh state against `knowledge.md` — flag any new PRs/issues
7. Emit a one-paragraph session-start report:
   - fork position (ahead/behind, changed files)
   - new upstream items since last session
   - any out-of-invariant state (fork behind, unexpected files)

Contract
--------
Output is a session-start block. No decisions are made — this prompt only
establishes ground truth. All outputs are appended to the current session
heading in `AI-ENGINEERING-STATE.md`.

Constraints
-----------
- Use live GitHub state (`gh`), not cached data
- Do not silently skip the `git diff --stat` — it is the fork-only file gate
- Do not modify any branch or file during startup — read-only gate