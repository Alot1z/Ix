# .agents/ — Fork Agent System Registry

Authoritative inventory of the persistent fork-local agent system. If an agent
is not listed here, it does not exist. Responsibilities, skills, and write
targets are the single source of truth for routing work; agent files in
`agents/`, `prompts/`, `skills/` are the implementations.

**Governance:** `../AGENTS.md` (fork constraints) +
`Alot1z/Ix-findings/AGENTS.md` (mandatory contribution lifecycle) +
`Alot1z/Ix-findings/knowledge.md` (domain knowledge).

## Agents

| Agent | Responsibility | Inputs | Outputs | Skills | Writes | Upstream access |
|---|---|---|---|---|---|---|
| `ix-orchestrator` | End-to-end session cycle; dispatches specialists; reconciles evidence | work-scope, `knowledge.md`, `planning/AI-ENGINEERING-STATE.md`, live `gh` | decision / contribution candidate / findings patch / close-out record | `ix-contribution-lifecycle` | `planning/` (state) | read |
| `ix-upstream-auditor` | Determine which upstream issues/PRs are legitimate high-value targets | `knowledge.md`, live `gh` | audit block + state matrix; `contribution_candidates` | `ix-upstream-audit` | `planning/`, `knowledge.md` refresh | read |
| `ix-pr-reviewer` | Adversarial review of upstream PRs (regressions, boundary, tests) | PR metadata + diff, live `gh`, Ix graph | advisory review with verdict | `ix-pr-review` | `planning/`; gated technical comments | read + gated comment |
| `ix-archaeologist` | Reconstruct commit/PR/issue/branch provenance chains | git history, `gh` | evidence-anchored archaeology report | — | `planning/` | read |
| `ix-commit-miner` | Extract and classify commits from upstream main/branches | git log, branches | classified commit corpus | — | `planning/` | read |
| `ix-contribution-miner` | Discover high-value contribution candidates from issues/PRs | live `gh` corpus | prioritized candidates | — | `planning/` | read |
| `ix-documentation-reviewer` | Review docs/LLM-format artifacts for accuracy/completeness | docs, generated artifacts | documentation review | — | `planning/` | read |
| `ix-final-reviewer` | Final adversarial pass before any fork-main commit or push | staged diff, gates | PASS/BLOCK verdict | — | none (gate) | read |
| `ix-git-reviewer` | Review git mechanics of a contribution branch pre-push | branch diff, ancestry | git review | — | none (gate) | read |
| `ix-ix-findings-reviewer` | Validate the local Ix-findings corpus consistency | Ix-findings checkout | corpus validation | `ix-findings-review` | Ix-findings (findings) | read |
| `ix-security-reviewer` | OSS/Pro boundary, dependency, and vulnerability review | PR diff, deps | security review | — | `planning/` | read |
| `ix-test-auditor` | Audit test landscape before/after contribution | test suites, tsc | test audit | — | `planning/` | read |
| `ix-session-closeout` | Produce durable, immutable session close-out records | session records | close-out record | `ix-session-closeout` | `planning/AI-ENGINEERING-STATE.md` | read |

## Prompts

| Prompt | Use |
|---|---|
| `ix-session-startup` | Session bootstrap: state, workspace, encoding, live-state gate |
| `ix-upstream-walkthrough` | Guided sweep of upstream PRs/issues with classification |
| `ix-adversarial-multi-agent-review` | Multi-specialist adversarial review orchestration |
| `ix-fork-sync-and-contribution-gate` | Fork sync + contribution readiness gate |
| `ix-session-closeout` | Structured session close-out procedure |

## Skills

| Skill | Implements | Route when |
|---|---|---|
| `ix-contribution-lifecycle` | The DISCOVER → … → FINAL REPORT pipeline (state machine in-file) | Any candidate finding/fix lifecycle |
| `ix-upstream-audit` | Upstream state sweep + classification | "what is the current upstream state" |
| `ix-pr-review` | External-PR adversarial review | "review upstream PR #n" |
| `ix-findings-review` | Ix-findings corpus validation | "is the findings corpus consistent" |
| `ix-session-closeout` | Session close-out + handoff | End of any non-trivial session |

## Routing rule

- Contribution intent → `ix-contribution-lifecycle` skill (the pipeline decides
  which specialist runs at each gate).
- Review intent → `ix-pr-review` / specialist directly.
- Pure state sweep → `ix-upstream-audit`.
- Every session end → `ix-session-closeout` (handoff into
  `planning/AI-ENGINEERING-STATE.md`).

## Maintenance

This registry is authoritative: when an agent/prompt/skill is added, changed,
or removed, update this table in the same commit. Agent upgrades follow the
self-upgrade rule in `../AGENTS.md` (evidence-based, minimal, isolated,
reversible, non-destructive).
