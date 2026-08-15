# Prompt: ix-fork-sync-and-contribution-gate


**Role: Alot1z collaborator/contributor -- advisory findings only. Not the official reviewer.**
**Workspace: C:\tmp\Ix-remap-tmp\**
**Encoding: All output must be valid UTF-8.**

Purpose
-------
Guides the orchestrator through a fork-sync verification cycle before and
after any fork-main mutation. Enforces the invariant (0 behind, intentional
ahead only) and the diff gate (no fork-local files in upstream PR diffs).

Usage
-----
Run before committing to fork/main, before pushing any branch, and at
session closeout. Acts as the structural gate between analysis and write.

Pre-mutation gate
-----------------
Before mutating fork/main:
1. `git fetch origin upstream && git fetch origin fork`
2. Confirm: `git rev-list --left-right --count origin/upstream/main...HEAD`
   â†’ must show `0 <N>` (0 behind, N ahead) â€” if behind, stop and report
3. Inspect: `git diff --stat origin/upstream/main...HEAD`
   â€” every file must be accounted for as intentional fork-local infrastructure
4. Inspect any upstream-contribution branch diff (if applicable):
   `git diff origin/upstream/main...HEAD` on that branch â€” must not contain
   `AGENTS.md`, `.agents/`, `knowledge.md`, `planning/`, or any fork-local file
5. Emit pre-mutation gate record:
   - gate status: CLEAR | BLOCKED
   - fork position (ahead/behind)
   - diff file list
   - any fork-local leakage risk

Post-mutation gate
------------------
After commit to fork/main (or after pushing a contribution branch):
1. `git fetch origin upstream && git fetch origin fork`
2. Recompute ahead/behind â€” confirm still 0 behind
3. Inspect: `git diff --stat origin/upstream/main...HEAD`
   â€” confirm changed files match the intent of the commit
4. If upstream-contribution branch was pushed: re-inspect its diff against
   upstream/main for fork-local leakage
5. Emit post-mutation gate record with SHA, file list, and comparison URL:
   https://github.com/ix-infrastructure/Ix/compare/main...Alot1z:Ix-remap:main

Commit message contract (for fork-main commits)
------------------------------------------------
Format: `<type>(<scope>): <subject>`

Types: `feat` | `fix` | `docs` | `refactor` | `chore`

Scope examples for fork infrastructure:
- `chore(agents): add specialist agent definitions`
- `docs(knowledge): refresh upstream state snapshot`
- `chore(governance): enhance AGENTS.md fork boundaries`
- `chore(planning): initialize AI-ENGINEERING-STATE.md`

Subject rule: plain language, no attribution, no tool branding.

Body rule: one blank line after subject. Body explains WHY not WHAT.
GitHub actions verb in body (closes/fixes/relates) only if PR/issue number
is intentional and authorized.

Constraints
-----------
- A BLOCKED gate stops the write. Escalate to user for override.
- Never say "verified" for the gate itself â€” the gate IS the verification.
- Record both pre- and post-mutation gate states in `AI-ENGINEERING-STATE.md`.