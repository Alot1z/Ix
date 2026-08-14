# Prompt: ix-upstream-walkthrough

Purpose
-------
Performs a full upstream archaeology walkthrough: enumerates all open PRs
and issues, reconstructs PR-to-issue mappings, identifies supersession
chains, and classifies the contribution landscape for the current session.

Usage
-----
Run by ix-orchestrator at session start or after upstream state changes.
Condensed into `knowledge.md` and `AI-ENGINEERING-STATE.md` when complete.

Sequence
--------
1. Fetch full open PR list:
   `gh pr list --repo ix-infrastructure/Ix --state open --json \
     number,title,author,headRefName,baseRefName,mergeable,mergeStateStatus,body,reviews`
2. Fetch full open issue list:
   `gh issue list --repo ix-infrastructure/Ix --state open \
     --json number,title,labels,body,assignees`
3. For each PR, inspect `body` for supersession language:
   "supersedes", "superseded by", "replaces", "replaced by"
4. Cross-reference issue numbers mentioned in PR bodies with `gh issue view`
5. For merged PRs (in `knowledge.md` history), confirm no branch in the fork
   carries the same name unless it is a deliberately maintained Alot1z branch
6. For Alot1z branches: check `git branch -r | grep origin/<name>` existence

Classification rules
--------------------
- `own-branch` — Alot1z-authored, branch exists in fork, open upstream PR
- `blocked-review` — any other author, CI green, mergeStateStatus=BLOCKED
- `merged` — closed+merged, do not touch
- `superseded` — explicitly replaced by another PR/maintainer-stated
- `zero-opportunity` — no gap; existing PR covers; duplicate; out of scope
- `contribution-candidate` — genuine open work with no Alot1z-backed PR

Output contract
---------------
- `walkthrough_id`, `as_of`
- `pr_register` with classification per PR
- `issue_register` with `has_open_pr` flag
- `supersession_chains` (old → new with evidence)
- `contribution_candidates` (top 5, rationale, scope, risk)
- `fork_branch_inventory` (Alot1z branches in fork, mapped to upstream PRs)
- `freshness_gap` — any state divergence from `knowledge.md`

Constraints
-----------
- Use live `gh` API only. Do not copy numbers from `knowledge.md` without
  cross-checking the live fetch.
- Never claim a branch is Alot1z-owned without checking the PR's `author.login`
  field.
- Do not propose a new upstream PR if any open PR already covers the issue.