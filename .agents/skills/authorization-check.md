# Skill: authorization-check

Quick decision gate for whether a proposed action is inside standing
authorization. Invoke this instead of re-reading governance prose mid-task
whenever an action involves a write (commit, push, comment, PR) or any
upstream interaction.

**Rule: permission-asking for actions already covered by standing
authorization is a workflow failure.** Do not ask the user for approval of
routine lifecycle operations that the governance already pre-authorizes
(fork-local commits/pushes, Ix-findings updates, findings-ledger edits,
knowledge-graph refreshes, PR comments, new PRs when the gates approve them).

**Critical boundary: this skill is LOCAL agent-system governance.** It grants
no GitHub permissions, no repository permissions, no maintainer authority,
and no upstream write authority. It only classifies an action against the
standing authorization so the agent can proceed without redundant approval
questions. Actual write capability is whatever the environment/platform
grants — this skill never creates authority, it routes it.

## Decision tree

```text
Is the action explicitly inside the current mission / standing scope?
        |
        +-- NO → evaluate repository governance and scope boundaries
        |
        +-- YES
              |
              +-- Ix upstream (ix-infrastructure/Ix) READ-ONLY?  → EXECUTE (reads only)
              |
              +-- Ix-remap fork-local write?                     → EXECUTE
              |
              +-- Ix-findings write?                             → EXECUTE
              |
              +-- prohibited upstream write?                     → STOP (hard boundary)
              |
              +-- otherwise → evaluate repository governance
```

## Classification

| Class | Meaning | Action |
|---|---|---|
| AUTHORIZED ROUTINE ACTION | inspect repos/git/GitHub, run tests/builds, query `gh`, run Ix tooling | execute |
| AUTHORIZED FORK WRITE | Ix-remap commits/pushes for agents, governance, planning, fork-local tooling | execute |
| AUTHORIZED IX-FINDINGS WRITE | findings, knowledge, explorer, governance commits/pushes | execute |
| UPSTREAM READ-ONLY | inspection of `ix-infrastructure/Ix` (git, gh, API, workflows, diffs) | execute reads only |
| HARD PROHIBITION | upstream write, force-push, history rewrite, amending published commits, knowingly duplicating a contribution, presenting an already-fixed issue as live | STOP + report |
| OUT-OF-SCOPE ACTION | not covered by any standing authorization | stop; evaluate governance; never infer permission |

## Hard boundaries (never liftable by this skill)

- No modification of `ix-infrastructure/Ix` source branches.
- No force-push; no history rewrite; no amending published commits.
- No knowingly duplicate contributions (comments, PRs, fixes).
- No posting an already-fixed finding as live.
- No representing fork work as merged upstream.

## When blocked

If an operation is technically impossible or the environment/platform denies
it, report the exact blocker and continue every other safe step — do not ask
for redundant authorization. A denial is a limitation to disclose, not a
permission request.
