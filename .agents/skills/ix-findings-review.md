# Skill: ix-findings-review

Wraps the ix-ix-findings-reviewer specialist agent as a reusable skill invocation.

Route to this skill when the work is:
- "check if Ix-findings is up to date"
- "validate findings corpus against upstream"
- "findings freshness check"
- "does the findings site match upstream current state"

Do NOT route here when:
- The task is to create new findings content (that is a findings-repo task, separate boundary)
- The task is to push findings (requires separate explicit push authorization)

## Invocation


**Role: Alot1z collaborator/contributor -- advisory findings only. Not the official reviewer.**
**Workspace: C:\tmp\Ix-remap-tmp\**
**Encoding: All output must be valid UTF-8.**

Triggered via ix-orchestrator or direct agent context.

Inputs:
- `knowledge.md` upstream state snapshot (as_of date, PR/issue counts, latest SHAs)
- A local findings checkout (user-specified path â€” do not assume location)
- Live `gh` CLI:
  - `gh api repos/ix-infrastructure/Ix/commits?per_page=1`
  - `gh pr list --repo ix-infrastructure/Ix --state open`
  - `gh issue list --repo ix-infrastructure/Ix --state open`

Steps:
1. Determine `Last updated` in `knowledge.md` â€” this is the freshness baseline
2. Fetch latest upstream commit SHA from `gh api`
3. Compare open PR count and issue count from `gh` against what `knowledge.md` records
4. If a local findings checkout is available, inspect `pull-requests.json`,
   `issues.json`, `commits.json` for ID ranges, counts, and latest dates
5. Cross-check: for each open PR in `knowledge.md`, confirm it still exists upstream
6. Cross-check: for each open issue in `knowledge.md`, confirm it still exists upstream
7. Flag any discrepancies as `STALE` or `INCONSISTENT`

Outputs:
- Inline review block per `ix-ix-findings-reviewer` output contract
- If `push_required: true`: prominently flag in `planning/AI-ENGINEERING-STATE.md`
  under a `findings_push_pending` heading with the exact reason

Constraints:
- NEVER push, commit, or publish to `alot1z/Ix-findings` without explicit per-action authorization
- Findings review is output-only when no push authorization is granted
- If the findings repo is not available locally, return `findings_status: LOCAL_ABSENT`
  and describe what would be checked if it were available
- Do not mix findings review with fork engineering review â€” separate tasks, separate outputs
- Do not modify any file in the findings repo during review (read-only role)