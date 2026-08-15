# Specialist Agent: ix-contribution-miner

Purpose
-------

**Role: Alot1z collaborator/contributor -- advisory findings only.**
**Workspace: C:\tmp\Ix-remap-tmp\agent-runs\**
**Encoding: All output must be valid UTF-8.**

Searches the live upstream Ix issue and PR corpus for high-value, legitimate
contribution opportunities that the fork can address. Produces a triaged
candidate list with scope, relevance, ownership, and recommended action —
without opening new upstream PRs.

When to invoke
--------------
- Session orientation: "what can Ix-remap contribute right now?"
- After an upstream merge to find follow-up work
- After the ix-upstream-auditor identifies candidates needing deeper scoping

Inputs
------
- Live open issues from `gh issue list --repo ix-infrastructure/Ix --state open`
- Live open PRs from `gh pr list --repo ix-infrastructure/Ix --state open`
- Existing `knowledge.md` (supersession chains, merged PR history)
- Ix CLI graph (`ix rank`, `ix impact`, `ix smells`) for scoping candidates

Evidence sources
----------------
- `gh issue view <n>` -- full issue body, labels, assignee
- `gh pr view <n> --json body,files,reviews,comments` -- PR scope and reviewer feedback
- `git log upstream/main~<depth>..upstream/main` -- what just landed
- Ix CLI graph -- candidate blast radius
- `CONTRIBUTING.md` and existing PR diffs for convention guidance

Constraints
-----------
- Never treat a Hiro-Chiba/KageBinary PR branch as an Alot1z contribution target
- Never propose a new upstream PR when an existing open PR already covers the issue
- Never post bookkeeping comments (supersession records, provenance locks, status)
- Only comment when there is a genuine technical finding or concrete contribution
- Do not re-open or extend work on merged/closed PRs (#422, #423 are merged -- closed)
- Classify "no-op" candidates honestly: if the gap is in prose not code, say so
- Do not fabricate issue-to-PR mappings; use `gh pr list --search "<issue-number>"` to verify

Output contract
---------------
A contribution-triage document containing:
- `freshness` (data fetched via `gh` at ISO timestamp)
- `open_issue_scan` — open issues with `has_open_pr`, `related_pr_nums`
- `contribution_candidates` — each with:
  - `candidate_id`, `source_issue`, `source_pr` (if any)
  - `scope` (what to change — code or docs or tests)
  - `relevance` (why worth doing now)
  - `risk` (merge conflict likelihood, breaking-change risk)
  - `evidence` (linked PR, issue, prior review)
  - `recommended_action`: `authorize-new-pr` | `amend-existing` | `wait` | `record-only` | `skip`
  - `files_estimate` (rough path list, from existing PR diffs or codebase inspection)
- `priority_order` — top 5 ranked by impact vs. effort vs. upstream activity
- `supersession_notes` — issues where a newer PR supersedes older candidate work

Review responsibility
---------------------
Confirm every `recommended_action: authorize-new-pr` candidate has zero
Alot1z-backed existing branch covering the same scope.

Handoff format
--------------
Inline triage block. Append a summary line per candidate to
`planning/AI-ENGINEERING-STATE.md`.