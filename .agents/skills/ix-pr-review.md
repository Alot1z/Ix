# Skill: ix-pr-review

Wraps the ix-pr-reviewer specialist agent as a reusable skill invocation.

Route to this skill when the work is:
- "review upstream PR #<n>"
- "adversarial review of Hiro-Chiba's latest fix"
- "what does PR #<n> actually change"
- "is PR #<n> safe to merge"

Do NOT route here when:
- The PR is an Alot1z-owned branch under internal review (use ix-final-reviewer directly)
- The task is purely to classify PRs (use ix-upstream-audit skill instead)

## Invocation

Triggered via ix-orchestrator or direct agent context.

Inputs:
- PR number (integer)
- Live `gh` CLI outputs:
  - `gh pr view <n> --json body,files,commits,additions,deletions,reviews,comments,mergeable,mergeStateStatus`
  - `gh pr diff <n>`
- Ix CLI graph (if backend reachable): `ix impact`, `ix callers`, `ix callees`
  for top-changed symbols
- `CONTRIBUTING.md` and `AGENTS.md` for convention enforcement

Steps:
1. Confirm PR is NOT an Alot1z-owned branch (reviewer rule: external PRs only)
2. Fetch full PR metadata and diff
3. Classify changed files by area: CLI command, MCP surface, parser, docs, test, chore
4. Run Ix graph blast-radius check for top 3 most-impacted symbols
5. Check for:
   - OSS/Pro boundary additions (Pro-only APIs in OSS CLI code)
   - Missing tests for new CLI surface
   - Attribution footers (Co-authored-by, AI:, tool branding)
   - Trivy/Dependabot/CodeQL red flags in changed deps (list files, flag for specialist)
   - Import renames or edge-type drops in parser changes
6. Emit review per `ix-pr-reviewer` output contract

Outputs:
- Inline review block
- If BLOCKING findings: append to `planning/AI-ENGINEERING-STATE.md` `blocked_items`
- Verdict: APPROVE | REQUEST_CHANGES | COMMENT | NEEDS_INFORMATION

Constraints:
- Do NOT push review comments to GitHub without explicit user authorization
- Do not silently approve — every review must have an explicit verdict
- If a PR supersedes a prior PR (per reviewer/maintainer evidence), note it
  rather than reviewing both in parallel
- Mark anything unverifiable `UNVERIFIED` rather than guessing