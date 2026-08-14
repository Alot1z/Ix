# Prompt: ix-session-closeout

Purpose
-------
Produces the durable session closeout record at the end of every Ix-remap
engineering session. Lock the final state, record work done, and set up
the next session's starting context.

Usage
-----
Run by ix-session-closeout agent at session end, after ix-final-reviewer
has issued a GO verdict (or after a NO-GO is recorded).

Sequence
--------
1. Confirm ix-final-reviewer verdict is recorded in this session's outputs
2. Collect Git state:
   - `git rev-parse origin/upstream/main` → upstream/main SHA
   - `git rev-parse origin/fork/main` → fork/main SHA
   - `git merge-base origin/upstream/main HEAD` → merge-base
   - `git rev-list --left-right --count origin/upstream/main...HEAD` → ahead/behind
   - `git log HEAD~<n>..HEAD --oneline` → this session's commits (where n = commit count)
   - `git diff --stat origin/upstream/main...HEAD` → fork-only files
3. Collect GitHub state:
   - `gh pr list --repo ix-infrastructure/Ix --state open --json number,title,status`
   - `gh issue list --repo ix-infrastructure/Ix --state open --json number,title`
4. Append a `## Session <ISO-timestamp>` heading block to
   `planning/AI-ENGINEERING-STATE.md` (do not overwrite prior headings):
   
   ```
   ## Session 2026-08-14T22:45Z
   
   State: FINAL_GO
   Duration: ~15min (estimate if exact duration not tracked)
   
   ### Fork State
   - upstream/main SHA: <sha>
   - fork/main SHA: <sha>
   - merge-base: <sha>
   - ahead/behind: <N ahead, 0 behind>
   - fork-only commits this session: <commit SHAs>
   - fork-only files this session: <absolute file list>
   - compare URL: https://github.com/ix-infrastructure/Ix/compare/main...Alot1z:Ix-remap:main
   
   ### Work Completed
   - <comma-separated list of artifacts created/updated>
   
   ### Outstanding Items
   - findings rebuild + push (blocked: no push authorization)
   - Ix-findings-reviewer pass (deferred)
   
   ### Exceptions
   - Backend: UNVERIFIED (Docker not started; graph commands not run)
   - findings repo: not available locally; review deferred
   
   ### Next Session Priority
   - 1. Run ix-adversarial-multi-agent-review on this session's artifacts
   - 2. Rebuild and verify findings corpus locally (no push)
   - 3. Sweep open Hiro-Chiba/KageBinary PRs for new review evidence
   
   ### Session Verdict
   FINAL_GO: fork-main mutation intention is consistent with invariant; diff
   contains only intended fork-local infrastructure.
   ```

5. Update `knowledge.md` `Last updated` timestamp if upstream state changed

Constraints
-----------
- Append-only: do not delete prior session headings
- Do not log secrets, tokens, absolute user paths, or local runtime values
- Record actual `git diff` file list — never say "no changes" without inspecting
- If the final-reviewer verdict was NO-GO, record `State: NO-GO` and name the blocking item