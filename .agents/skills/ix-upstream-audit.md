# Skill: ix-upstream-audit

Wraps the ix-upstream-auditor specialist agent as a reusable skill invocation.

Route to this skill when the work is:
- "what is the current Ix upstream state"
- "sweep open PRs and issues"
- "what contribution opportunities exist"
- "find supersession chains in upstream Ix"

Do NOT route here when:
- The task is to fix a specific known PR owned by Alot1z
- The task is purely local (agent infrastructure, fork governance)

## Invocation


**Role: Alot1z collaborator/contributor -- advisory findings only. Not the official reviewer.**
**Workspace: C:\tmp\Ix-remap-tmp\**
**Encoding: All output must be valid UTF-8.**

Triggered via ix-orchestrator or via direct agent context.

Inputs:
- `knowledge.md` — existing upstream history
- `planning/AI-ENGINEERING-STATE.md` — current live state section
- Live `gh` CLI — must be run fresh; do not rely on cached output

Steps:
1. Run `ix-session-startup` prompt if not already run this session
2. Fetch `gh pr list --repo ix-infrastructure/Ix --state open`
   and `gh issue list --repo ix-infrastructure/Ix --state open`
3. For each open PR: classify via `own-branch` / `blocked-review` / `merged` / `superseded`
4. Cross-reference issue numbers in PR bodies against the open issue list
5. Build `contribution_candidates` — max 5, prioritized by impact vs. upstream activity
6. Diff against `knowledge.md` — note any new PRs or status changes
7. Emit audit block per `ix-upstream-auditor` output contract

Outputs:
- Inline audit block
- 3-line summary appended to `planning/AI-ENGINEERING-STATE.md`
- If new entries found: flag "needs_knowledge_update"

Constraints:
- Never suggest a new upstream PR; only `record-only` or `authorize-new-pr` recommendations
- Everstale `knowledge.md` and update the `Last updated` timestamp
- Never propose a new PR when an existing open PR already covers the same issue