# Prompt: ix-adversarial-multi-agent-review


**Role: Alot1z collaborator/contributor -- advisory findings only. Not the official reviewer.**
**Workspace: C:\tmp\Ix-remap-tmp\**
**Encoding: All output must be valid UTF-8.**

Purpose
-------
Coordinates a structured multi-perspective review of a proposed contribution
or artifact before it is finalized. Each perspective is a specialist agent
invoked in sequence; the orchestrator reconciles conflicting verdicts and
produces a single consolidated result.

Usage
-----
Run before committing contribution work to fork/main or before pushing any
upstream branch. Produces a signed review packet.

Reviewer sequence
-----------------
For contributor work:
1. ix-test-auditor — test and typecheck gate
2. ix-git-reviewer — commit hygiene, diff scope, upstream pollution
3. ix-security-reviewer — dependency, OSS/Pro boundary, OSS boundary
4. ix-documentation-reviewer — doc accuracy, CLAUDE.md staleness, contamination
5. ix-pr-reviewer — adversarial code review of the PR diff
6. ix-final-reviewer — GO/NO-GO synthesis

For fork infrastructure work (this session's scope):
1. ix-git-reviewer - commit hygiene and diff scope
2. ix-final-reviewer — GO/NO-GO synthesis (no upstream pollution risk)

Sequence rules
--------------
- Each specialist emits its output contract (see individual agent files)
- The orchestrator collects all outputs before invoking ix-final-reviewer
- If any specialist returns BLOCKED, the orchestrator surfaces the blocking
  item verbatim before proceeding
- The final reviewer overrides no specialist verdict — it synthesizes

Final-reviewer gate checklist
------------------------------
- [ ] `npm run typecheck` passed this session (or backend: UNVERIFIED, noted)
- [ ] `npm test` passed where applicable
- [ ] `git diff origin/upstream/main...HEAD` inspected — no fork-local leakage
- [ ] No attribution footers in any commit message in the diff
- [ ] No secrets, tokens, or local paths in any committed file
- [ ] All specialist outputs read and reconciled
- [ ] Unverified claims explicitly marked `state:unverified`

Verdict contract
----------------
- `GO` — all prerequisites met, exceptions documented, commit may proceed
- `NO-GO` — at least one blocking item, exact item named, work halted

Output contract
---------------
A review packet containing:
- `packet_id` (session timestamp + scope hash)
- `scope`, `as_of`
- `specialist_outputs` — one block per specialist with verdict
- `conflicts` — any disagreements between specialists, with resolution
- `prerequisites_checklist` — boolean per item above
- `exceptions` — anything unverified, backend: UNVERIFIED, etc.
- `verdict` (GO | NO-GO) with one-sentence mandatory rationale
- `follow_up` — exact next step on GO; exact blocking item on NO-GO

Constraints
-----------
- A NO-GO verdict is not negotiable within this prompt — it halts the write
- Do not skip any specialist in the sequence above without explicit note in
  `exceptions` explaining why
- The orchestrator may not override a NO-GO; only the user can re-authorize