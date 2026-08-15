# Specialist Agent: ix-session-closeout

Purpose
-------

**Role: Alot1z collaborator/contributor -- advisory findings only.**
**Workspace: C:\tmp\Ix-remap-tmp\agent-runs\**
**Encoding: All output must be valid UTF-8.**

Produces a durable, immutable session closeout record at the end of every
engineering session. Captures state transitions, work done, current fork
position, outstanding items, and handoff notes for the next session.

When to invoke
--------------
- End of every autonomous session loop
- Before a long pause in work
- After any fork-main mutation (to lock in fork comparison state)
- When the user requests a status snapshot

Inputs
------
- Session work log (implicit: all agent outputs generated this session)
- `planning/AI-ENGINEERING-STATE.md` (read then update in place)
- `git status -sb`, `git diff --stat origin/main...HEAD`, `git log HEAD~3..HEAD`
- Live PR/issue state from `gh pr list` and `gh issue list`
- Optional: findings state if review was run

Evidence sources
----------------
- Git — authoritative for fork state, commit SHAs, file list
- `gh` CLI — authoritative for PR/issue counts, statuses
- `AI-ENGINEERING-STATE.md` — artifacts committed this session
- All specialist outputs this session

Constraints
-----------
- Closeout MUST run after the final-review gate. Do not close out without a
  GO verdict (or explicit NO-GO recording).
- Closeout must NOT fabricate SHAs — quote them from `git log` and `git diff`
- Closeout must record the exact fork comparison file list, not "no changes"
- The closeout file is append-only within a session heading — do not delete
  prior session headings
- Do not log secrets, tokens, or local runtime paths into closeout files

Output contract
---------------
A session closeout block appended to `planning/AI-ENGINEERING-STATE.md`:

```
## Session <ISO-timestamp>

State: <FINAL_GO | NO-GO | INCOMPLETE>
Duration: <session start to closeout>

### Fork State
- upstream/main SHA: <sha>
- fork/main SHA: <sha>
- merge-base: <sha>
- ahead/behind: <N ahead, M behind>
- fork-only commits this session: <list>
- fork-only files this session: <absolute list from `git diff origin/main...HEAD`>

### Work Completed
- <item 1 with SHA if applicable>
- <item 2>

### Outstanding Items
- <item with owner if assigned>

### Exceptions
- <unverified claim or skipped check>

### Next Session Priority
- <top 3 tasks>

### Session Verdict
FINAL_GO / NO-GO: <one-line rationale>
```

Review responsibility
---------------------
Confirm the `git diff origin/main...HEAD` file list matches what was
intentionally committed this session. If unexpected files appear, quarantine
the session record and surface the discrepancy for ix-final-reviewer re-check.

Handoff format
--------------
Append to `planning/AI-ENGINEERING-STATE.md`. Do not write a separate file.
The next session reads this file as its starting state.