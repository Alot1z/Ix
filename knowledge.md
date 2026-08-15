# Ix-remap -- Project Knowledge

Last updated: 2026-08-15T01:50Z (agent system updated to collaborator role; all stale PR comments removed)

## Collaborator Role

All agents operate as **Alot1z collaborator/contributor** -- NOT as official
Ix maintainers or reviewers. All review findings are advisory. The final
decision belongs to the repository maintainers/code owners.

## Project-Scoped Workspace

All execution artifacts go to `C:\tmp\Ix-remap-tmp\` (not arbitrary /tmp/).
All text output must be valid UTF-8 (no mojibake).

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
- **#428** `fix(mcp): mark smells as mutating` — Hiro-Chiba → **MERGED** (commit `250db8a`, approved by KageBinary, fixes #427)
- **#430** `fix(context): validate pick option` — Hiro-Chiba → closed, superseded by #438
- **#432** `fix(mcp): reject conflicting ingest sources` — Hiro-Chiba → **MERGED** (commit `d8dfb82`, approved by KageBinary, fixes #431)
- **#438** `fix(cli): validate pick options consistently` — Hiro-Chiba → **MERGED** (commit `043bc68`, approved by KageBinary, fixes #437; supersedes #430)
- **#426** `fix(mcp): truncate long error output` — Hiro-Chiba → closed, superseded by #436/#444

### Open PRs — Hiro-Chiba (live reviewDecision as of 23:05Z; #428/#432/#438 now MERGED)
| PR | Branch | reviewDecision | Notes |
|---|---|---|---|
| #434 | fix/renamed-type-imports | REVIEW_REQUIRED | Supersession candidate: #443 more complete |
| #436 | fix/mcp-error-output-cap | REVIEW_REQUIRED | Replaces #426; extended by #444 |
| #440 | fix/ts-module-resolution | REVIEW_REQUIRED | Superseded by #445 |
| #442 | fix/php-namespace-resolution | REVIEW_REQUIRED | Superseded by #446 |

### Open PRs — KageBinary (newer branches, potentially superseding Hiro-Chiba; all REVIEW_REQUIRED as of 22:55Z)
| PR | Branch | Notes |
|---|---|---|
| #443 | fix/434-default-import-guard | More complete fix for #434 territory |
| #444 | fix/436-truncated-failure-reason | Updates #436 territory (keeps reason cap fix) |
| #445 | fix/440-baseurl-authority | Updates #440 territory |
| #446 | fix/442-php-use-clause-scope | Updates #442 territory (adds DoS fix) |

### Open Issues (as of 23:05Z — 3 FIXED by merged PRs, 6 remain open)
| Issue | Title | Status | Related PRs |
|---|---|---|---|
| #425 | MCP reports truncated in-process output as success | **OPEN** | #436, #444 |
| #427 | ix_smells advertised as read-only while storing claims | **FIXED** (merged #428) | #428 |
| #429 | ix context crashes on non-numeric --pick value | **OPEN** | #438 |
| #431 | ix_ingest silently ignores path when github is also set | **FIXED** (merged #432) | #432 |
| #433 | Renamed TypeScript imports drop inheritance edges | **OPEN** | #434, #443 |
| #435 | Thrown command errors bypass the MCP output cap | **OPEN** | #436, #444 |
| #437 | Malformed --pick values accepted by non-context commands | **FIXED** (merged #438) | #438 |
| #439 | tsconfig paths and baseUrl ignored during edge resolution | **OPEN** | #440, #445 |
| #441 | PHP imports resolve to classes from wrong namespace | **OPEN** | #442, #446 |

> No Alot1z-authored open branches exist. Do NOT create new upstream PRs without explicit authorization.

### Approvals since last refresh
- **#428** fix(mcp): mark smells as mutating — APPROVED (Hiro-Chiba)
- **#432** fix(mcp): reject conflicting ingest sources — APPROVED (Hiro-Chiba)
- **#438** fix(cli): validate pick options consistently — APPROVED (Hiro-Chiba; replaces #430)
- All others: REVIEW_REQUIRED (mergeStateStatus=BLOCKED across the board — branch protection / status checks still running)

### Supersession documentation comments posted
All 8 open PRs now carry technical supersession/provenance documentation:

| PR | Type | Comment URL |
|---|---|---|
| #434 | Supersession record | https://github.com/ix-infrastructure/Ix/pull/434#issuecomment-5298622510 |
| #436 | Supersession record | https://github.com/ix-infrastructure/Ix/pull/436#issuecomment-5298623086 |
| #440 | Supersession record | https://github.com/ix-infrastructure/Ix/pull/440#issuecomment-5298635491 |
| #442 | Supersession record | https://github.com/ix-infrastructure/Ix/pull/442#issuecomment-5298635881 |
| #443 | Provenance lock | https://github.com/ix-infrastructure/Ix/pull/443#issuecomment-5298637348 |
| #444 | Provenance lock | https://github.com/ix-infrastructure/Ix/pull/444#issuecomment-5298637764 |
| #445 | Provenance lock | https://github.com/ix-infrastructure/Ix/pull/445#issuecomment-5298639620 |
| #446 | Provenance lock | https://github.com/ix-infrastructure/Ix/pull/446#issuecomment-5298639947 |

**Supersession chains confirmed:**
- Hiro-Chiba #434 → KageBinary #443 (default-import guard)
- Hiro-Chiba #436/#426 → KageBinary #444 (truncated failure reason)
- Hiro-Chiba #440 → KageBinary #445 (regex security hardening: OOM + device-node + path traversal)
- Hiro-Chiba #442 → KageBinary #446 (sticky truncation flag + DoS hardening)

All comments posted as technical indexes only. No maintainer tags.

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