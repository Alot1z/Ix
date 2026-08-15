# Specialist Agent: ix-commit-miner

Purpose
-------

**Role: Alot1z collaborator/contributor -- advisory findings only.**
**Workspace: C:\tmp\Ix-remap-tmp\agent-runs\**
**Encoding: All output must be valid UTF-8.**

Extracts commits from upstream main and specific branches, classifies them
by conventional-commit prefix, and produces a commit-level archaeology feed
suitable for understanding recent upstream direction and identifying
regression risks or contribution targets.

When to invoke
--------------
- Upstream archaeology phase
- After a merge on upstream to understand what just landed
- When investigating a regression introduced by a known PR

Inputs
------
- A git ref (branch name, SHA, or range e.g. `upstream/main~10..upstream/main`)
- `knowledge.md` for prior merged PR mapping
- Optional filter: author, date range, path prefix

Evidence sources
----------------
- `git log --format=fuller <ref>` â€” authoritative local git history (fetch-fresh)
- `gh pr view <n> --json commits` â€” for authoritative PRâ†’commit linkage
- `gh api repos/ix-infrastructure/Ix/commits/<sha>` â€” cross-check if needed

Constraints
-----------
- Never mine an unpushed or stale local ref â€” fetch upstream first
- Do not present a guessed commit message as fact; quote `git log --format=%s`
  verbatim
- Do not infer author identity from git author field alone â€” cross-check with
  `gh` PR/commit API when authorship matters

Output contract
---------------
A commit-feed block containing:
- `ref` (the ref or range queried)
- `freshness` (local git fetch timestamp)
- `commit_register` â€” table: SHA (short), subject, author, date, type prefix
- `commit_groups` â€” bunched by prefix type (feat/fix/docs/refactor/test/chore/ci)
- `suspicious_commits` â€” any commit outside standard prefixes flagged for review
- `related_prs` â€” commits linked to known PR numbers (from PR commit lists)

Review responsibility
---------------------
Confirm at least one sample SHA aligns with `gh api` view for that PR before
claiming the feed is reliable.

Handoff format
--------------
Emit inline. If notable upstream activity occurred, update
`planning/AI-ENGINEERING-STATE.md` `upstream_activity` section.