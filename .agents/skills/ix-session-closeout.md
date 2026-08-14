# Skill: ix-session-closeout

Wraps the ix-session-closeout specialist agent as a reusable skill invocation.

Route to this skill when:
- "close out this session"
- "record current state"
- "session snapshot"
- end-of-session closeout is required

Do NOT route here when:
- Mid-session checkpointing (use ix-upstream-audit instead)
- The session ended in a NO-GO state that needs remediation first

## Invocation

Triggered by ix-orchestrator after ix-final-reviewer GO verdict.

Steps:
1. Confirm ix-final-reviewer verdict for this session is recorded
2. Run Git state commands (all read-only):
   - `git rev-parse origin/upstream/main`
   - `git rev-parse origin/fork/main`
   - `git merge-base origin/upstream/main HEAD`
   - `git rev-list --left-right --count origin/upstream/main...HEAD`
   - `git log HEAD~<n>..HEAD --oneline` (n = commit count on fork/main since upstream/main)
   - `git diff --stat origin/upstream/main...HEAD`
3. Run GitHub state commands:
   - `gh pr list --repo ix-infrastructure/Ix --state open --json number,title`
   - `gh issue list --repo ix-infrastructure/Ix --state open --json number,title`
4. Append `## Session <ISO-timestamp>` block to `planning/AI-ENGINEERING-STATE.md`
   using the format from `ix-session-closeout` agent definition
5. Update `knowledge.md` `Last updated` timestamp

Outputs:
- Appended session closeout block in `planning/AI-ENGINEERING-STATE.md`
- Terminal session summary: fork state, work completed, next priority

Constraints:
- Append-only on `AI-ENGINEERING-STATE.md` — never overwrite prior session headings
- Do not log secrets, tokens, absolute paths, or local runtime values
- Record actual `git diff` file list — never say "no changes" without running the command
- On NO-GO sessions: record `State: NO-GO` and name the exact blocking item verbatim