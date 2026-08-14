# Ix-remap — Project Knowledge

Last updated: 2026-08-14T22:35Z

## Repository Architecture

| Layer | Location | Purpose |
|---|---|---|
| Product code | `ix-cli/`, `core-ingestion/` | TypeScript CLI + tree-sitter parser (26 languages) |
| Agent skill | `skills/ix/` | Shipped Ix agent skill for this repo (bootstrap, commands, refs) |
| Root governance | `AGENTS.md` | Fork rules: no attribution, fork boundaries, verification policy |
| Fork agent infra | `.agents/` (this tree) | Persistent specialist system — NOT upstream product |
| Planning state | `planning/AI-ENGINEERING-STATE.md` | Verified current state, open work, invariants |
| Findings | `alot1z/Ix-findings` (separate repo) | Engineering evidence, public site, independent push auth |

## Repositories

| Repo | URL | Role |
|---|---|---|
| upstream (origin upstream) | https://github.com/ix-infrastructure/Ix.git | Canonical product source — fetch only |
| fork (origin fork) | https://github.com/Alot1z/Ix-remap.git | Personal fork — push target |
| findings | https://github.com/alot1z/Ix-findings | Engineering evidence corpus + published site |

## Git Remote Policy

```
origin upstream  → https://github.com/ix-infrastructure/Ix.git   (fetch only — NEVER push)
origin fork     → https://github.com/Alot1z/Ix-remap.git         (fetch + push target)
```

Push to ONLY `origin fork`. Do not push to origin upstream or any other remote.

## Invariant

Alot1z/Ix-remap:main MUST be:
- **0 commits behind** upstream/main
- Ahead only by deliberate fork-local infrastructure, governance, state, or approved product history

Re-verify after EVERY fork-main mutation:
https://github.com/ix-infrastructure/Ix/compare/main...Alot1z:Ix-remap:main

## Upstream State Snapshot (2026-08-14 — live via gh CLI)

### Merged PRs (reference only — do NOT append)
- **#422** `feat(context): deterministic bounded context bundles via ix context` — Hiro-Chiba → merged
- **#423** `feat(mcp): annotate tools and expose structured output` — Hiro-Chiba → merged
- **#426** `fix(mcp): truncate long error output` — Hiro-Chiba → closed, superseded by #436
- **#430** `fix(cli): validate pick options consistently` — Hiro-Chiba → closed, superseded by #438

### Open PRs — Hiro-Chiba (BLOCKED on review, all CI/CodeQL green)
| PR | Branch | Notes |
|---|---|---|
| #428 | fix/mcp-smells-write-annotation | No Alot1z branch, do not rebase |
| #432 | fix/mcp-ingest-source-validation | -- |
| #434 | fix/renamed-type-imports | Supersession candidate: #443 more complete |
| #436 | fix/mcp-error-output-cap | Replaces #426 |
| #438 | fix/shared-pick-validation | Replaces #430 |
| #440 | fix/ts-module-resolution | No replacement PR |
| #442 | fix/php-namespace-resolution | No replacement PR |

### Open PRs — KageBinary (newer branches, potentially superseding Hiro-Chiba)
| PR | Branch | Notes |
|---|---|---|
| #443 | fix/434-default-import-guard | More complete fix for #434 territory |
| #444 | fix/436-truncated-failure-reason | Updates #436 territory |
| #445 | fix/440-baseurl-authority | Updates #440 territory |
| #446 | fix/442-php-use-clause-scope | Updates #442 territory |

### Open Issues (no Alot1z PR backing them all)
| Issue | Title | Related PRs |
|---|---|---|
| #425 | MCP reports truncated in-process output as success | #436, #444 |
| #427 | ix_smells advertised as read-only while storing claims | #428 |
| #429 | ix context crashes on non-numeric --pick value | #438 |
| #431 | ix_ingest silently ignores path when github is also set | -- |
| #433 | Renamed TypeScript imports drop inheritance edges | #434, #443 |
| #435 | Thrown command errors bypass the MCP output cap | #436, #444 |
| #437 | Malformed --pick values accepted by non-context commands | #438 |
| #439 | tsconfig paths and baseUrl ignored during edge resolution | #440, #445 |
| #441 | PHP imports resolve to classes from wrong namespace | #442, #446 |

> No Alot1z-authored open branches exist. Do NOT create new upstream PRs without explicit authorization.

## Ix CLI Facts (from CLAUDE.md)

- Node >= 22 required
- Backend: Docker (ArangoDB on 127.0.0.1:8529, Memory Layer on 127.0.0.1:8090)
- `ix reset` is GLOBAL — wipes ALL workspace graphs (use /v1/reset/workspace for scoped)
- OSS/Pro command boundary is runtime-derived from `oss.ts` snapshot
- `ix patches` is OSS despite also being in Pro — OSS registers first, wins silently
- `ix upgrade` wipes `~/.ix/cli/compass` assets; use `IX_SKIP_COMPASS=1` to skip
- Windows path trap: Git Bash `/tmp` ≠ Windows `C:\tmp`
- Pro-only commands: `plan`, `plans`, `task`, `tasks`, `workflow`, `decide`, `decisions`, `goal`, `truth`, `bug`, `briefing`, `patches`
- After code changes: run `ix map --silent`

## AGENTS.md Policy Summary

The existing `AGENTS.md` defines three rules:
1. **No attribution footers** — no Co-authored-by, AI:, Codebuff, or tool branding in any commit/PR/issue/comment
2. **GitHub write policy** — no pushes to upstream, no GitHub writes without per-action authorization, authorized comments are technical indexes only
3. **Verification before claims** — run tests before claiming verification; never fabricate references

This fork-local agent system builds ON these rules, adding them as constraints to every specialist agent definition.

## Skill Ecosystem Used

Primary: `ix` (codebase intelligence via Ix CLI graph), `using-agent-skills` (skill discovery), `orchestration` (multi-agent coordination patterns), skill-authoring workflow from `system-connector`.
Supporting: `parasite-skill` (skill routing, compose, scan).