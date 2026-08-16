# Ix-remap — planning/ index

Fork-local planning and state infrastructure. This directory is fork-local
engineering infrastructure: it MUST NOT appear in upstream Ix PR diffs
(see `AGENTS.md` fork/upstream separation).

## What lives here

| Path | Role |
|---|---|
| `AI-ENGINEERING-STATE.md` | Session state log — the fork agent system's designated persistence target (ix-orchestrator, ix-pr-review, ix-upstream-audit append here). Append-only, dated `## Session <ISO-timestamp>` entries. |
| `README.md` | This index + migration map. |

## Migration map (2026-08-16)

| Historical | Current | Status | Reason |
|---|---|---|---|
| `planning/AI-ENGINEERING-STATE.md` (local branch `clean-rebuild`, tip `554546e`) | restored here, same blob `2126d26c` | RESTORED | The agent system persists session state to this path; its absence broke every handoff instruction. |
| `planning/audit/**` (57 files, phases 3–29, `clean-rebuild`) | `clean-rebuild` branch (local, unpushed) | PRESERVED AS PROVENANCE | Session artifacts; durable lessons extracted into Ix-findings. Not restored to avoid clutter. |
| `planning/findings/registry.json` (24 records) | `Alot1z/Ix-findings` `planning/findings/` | AUTHORITATIVE | Findings registry lives in the findings repo. |
| Durable environment knowledge | `Alot1z/Ix-findings` `knowledge.md` | AUTHORITATIVE | What the environment IS (Ix architecture, Kage/KageBinary, RavelScope, tool availability, lessons). |
| Mandatory agent behavior | `Alot1z/Ix-findings` `AGENTS.md` | AUTHORITATIVE | Contribution lifecycle, live-upstream gate, duplicates, tool honesty, ledger surgery, GitHub safety. |
| Agent definitions/prompts/skills | `.agents/` (this repo) | AUTHORITATIVE | Reusable specialist roles; `ix-contribution-lifecycle` skill implements the pipeline. |

## What belongs here (and what does not)

```
planning/
├── README.md                  ← this index (intentionality rules)
└── AI-ENGINEERING-STATE.md    ← session state log (append-only, dated entries)

HISTORICAL audit artifacts (phases 3-29)  → preserved on `clean-rebuild` branch
Temporary worktrees / probes / temp files → NEVER committed
Contribution evidence / findings         → Ix-findings (registry + PR-audit report)
Durable agent state & invariants         → Ix-findings `knowledge.md`
Agent behavior rules                     → this repo `AGENTS.md` + Ix-findings `AGENTS.md`
Findings evidence / ledger               → Ix-findings `planning/findings/registry.json`
Machine-readable knowledge graph         → Ix-findings `knowledge/`
```

Nothing else may accumulate under `planning/`. If a new artifact type appears
repeatedly, add a rule for it here first — do not let `planning/` become an
uncontrolled dumping ground.

## Rule

Session state and handoffs → `AI-ENGINEERING-STATE.md`.
Findings evidence → Ix-findings registry.
Durable knowledge → Ix-findings `knowledge.md`.
Agent behavior rules → Ix-findings `AGENTS.md` (operational layer) + this
repo's `AGENTS.md` (fork-local constraints).
