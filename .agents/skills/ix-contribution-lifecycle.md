# Skill: ix-contribution-lifecycle

Deterministic pipeline for taking a candidate finding from discovery to a
verified, communicated contribution. This is the reusable procedure; the
**mandatory rules** live in `Alot1z/Ix-findings/AGENTS.md` (governance layer)
and the domain context in `Alot1z/Ix-findings/knowledge.md`. When this skill
and the governance disagree, the governance wins.

**Role: Alot1z collaborator/contributor — advisory findings only.**
**Workspace: C:\tmp\Ix-remap-tmp\**
**Encoding: All output must be valid UTF-8.**

Route to this skill when the work is:
- "audit PR #<n>"
- "verify this finding"
- "contribute a fix for <bug>"
- "should we publish / comment / open a PR for <finding>"
- any task that walks the DISCOVER → … → FINAL REPORT lifecycle

Do NOT route here when:
- The task is a pure upstream-state sweep (use `ix-upstream-audit`)
- The task is an external-PR review with no contribution intent (use `ix-pr-review`)
- The task is purely local agent infrastructure (no upstream object involved)

## Workflow state machine

Track every candidate through explicit states; a gate transition requires the
listed evidence. Terminal states end the lane.

```text
DISCOVERED
   ↓ (context + existing-finding check)
LIVE_STATE_VERIFIED        (fresh fetch + gh, current heads recorded)
   ↓
DUPLICATE_CHECKED          (multi-signal search: prs/issues/code/log/registry)
   ↓
REPRODUCED                 (valid fixture, fail-before on current upstream)
   ↓
ADVERSARIAL_TESTED         (controls + boundary matrix, no suppression found)
   ↓
PR_WORTHINESS_DECIDED      (live + incorrect + meaningful + fixable + testable)
   ↓
CONTRIBUTION_TARGET_SELECTED (existing-PR follow-up vs new PR)
   ↓
FORK_COMMIT_VERIFIED       (parent, --check, focused files)
   ↓
PUBLISHED                  (fork push + ls-remote verification)
   ↓
COMMUNICATION_VERIFIED     (comment ID/URL or PR number/URL/SHA; upstream head unchanged)
   ↓
FINDING_DOCUMENTED         (surgical registry update)
   ↓
FINAL_REPORT
```

Terminal states (stop the lane, do not publish):

```text
ALREADY_FIXED · DUPLICATE · ALREADY_BEING_FIXED · FALSE_POSITIVE ·
LOW_VALUE · UNSAFE · BLOCKED
```

## Pipeline (no step may be silently skipped)

1. **DISCOVER / RECOVER CONTEXT** — read `knowledge.md` (fork) and
   `Alot1z/Ix-findings/knowledge.md`; check `planning/findings/registry.json`
   for an existing finding ID. Do not duplicate an existing finding.
2. **CHECK LIVE UPSTREAM** — always fresh:
   `gh pr view <n> --json state,headRefOid,baseRefName,commits,comments,reviews`
   + `git fetch origin`. A SHA from an old audit is a hypothesis.
3. **SEARCH DUPLICATES** — `gh search prs/issues/code` + registry + git log
   on affected files, using multiple signals (symbols, test names, reproducer
   shape). Competing work ⇒ terminal state, document the relationship.
4. **REPRODUCE** — smallest valid fixture; verify literal bytes (PHP
   backslashes, escaping); compare base vs PR head vs fixed state via
   per-state worktrees and builds. Invalid reproducer ⇒ terminal state.
5. **CLASSIFY** — exactly one of: CURRENT REGRESSION · CURRENT PRE-EXISTING
   BUG · HISTORICAL REGRESSION ALREADY FIXED · DUPLICATE · ALREADY BEING
   FIXED · FALSE POSITIVE · INFORMATIONAL · LOW VALUE · NEW ADDITIVE BUG.
6. **ASSESS PR-WORTHINESS** — live + objectively incorrect + meaningful +
   compact reproducer + unambiguous expected behavior + minimal safe fix +
   regression-testable.
7. **ADVERSARIAL TEST** — positive/negative controls, same-line/multi-line,
   boundaries, decoys, ambiguity, in-batch, cross-batch, incremental,
   fallback. Ask: can this fix make Ix less correct anywhere?
8. **VERIFY COMMIT** — `git diff --check`, parent check, `--name-only`,
   `--stat`; no generated/audit/ledger files in a code commit.
9. **PUBLISH FORK** — push the verified commit to the dedicated fork branch;
   verify `git ls-remote fork <branch>`.
10. **UPDATE FINDINGS** — surgical registry update only (preserve CRLF, IDs,
    no reserialization); record corrective commit, publication URL, PR/comment
    URLs, status.
11. **CHECK PR COMMUNICATION** — inspect the entire current conversation for
    the finding/commit. Already surfaced ⇒ no duplicate comment.
12. **COMMENT OR OPEN PR** — existing open PR owns the bug ⇒ comment with the
    fork commit URL, verification, and cherry-pick request. Independent live
    bug with no owner ⇒ new PR (correct base, clean ancestry, focused diff).
13. **VERIFY REMOTE WRITE** — confirm comment ID/URL or PR number/URL/SHA;
    confirm upstream source branch unchanged.
14. **FINAL REPORT** — verdict, live upstream, bug verification, adversarial,
    tool availability, exact test counts, commits, findings, communication,
    safety confirmation.

## Ownership decision (gate 12)

| Situation | Action |
|---|---|
| Bug introduced by/exposed by an open upstream PR | fork fix → verify → comment on that PR → maintainer cherry-pick |
| Independent live bug, no owner, no duplicate | fork fix → verify → new PR |
| Already fixed / duplicate / being fixed | nothing upstream; record relationship |
| Pre-existing low-value | record and defer unless independently justified |

## Outputs

- Inline pipeline trace (which gates passed, with evidence)
- `planning/AI-ENGINEERING-STATE.md` session entry (handoff + next steps)
- Findings registry update where a finding was added/changed
- Final report per the governance's reporting contract

## Constraints

- Never modify an upstream source branch; never force-push; never amend a
  published commit; never claim a fork commit is merged upstream.
- Tool honesty: AVAILABLE / PARTIALLY AVAILABLE / UNAVAILABLE for every tool;
  never claim subagents, RavelScope, or graph queries that did not run.
- Findings registry edits are surgical only.
- If a gate fails, stop that lane and report — do not force the contribution
  through.
