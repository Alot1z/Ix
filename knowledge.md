# Ix-remap -- Project Knowledge

Last updated: 2026-08-16 (PR-audit era complete: F-014..F-021, five published
contributions incl. PR #448; see "PR-Audit Era" section at the end; durable
guidance consolidated in Alot1z/Ix-findings `knowledge.md` + `AGENTS.md`)

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
| upstream (`origin`) | https://github.com/ix-infrastructure/Ix.git | Canonical product source — fetch only |
| fork (`fork`) | https://github.com/Alot1z/Ix-remap.git | Personal fork — push target |
| findings | https://github.com/alot1z/Ix-findings | Engineering evidence corpus + published site |

## Git Remote Policy

```
origin  → https://github.com/ix-infrastructure/Ix.git   (upstream — fetch only, NEVER push)
fork    → https://github.com/Alot1z/Ix-remap.git         (fork — fetch + push target)
```

Push to ONLY `fork`. Do not push to `origin` or any other remote.

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

### Open PRs — KageBinary (consolidations carrying Hiro-Chiba's commits; all OPEN as of 2026-08-15T07:47Z)
| PR | Branch | Notes |
|---|---|---|
| #443 | fix/434-default-import-guard | Carries Hiro-Chiba #434 + default-import guard; merge-commit (not squash) requested |
| #444 | fix/436-truncated-failure-reason | Carries Hiro-Chiba #426/#436 + reason-cap fix |
| #445 | fix/440-baseurl-authority | Carries Hiro-Chiba #440 + authority/security fixes (path traversal, device-node, OOM) |
| #446 | fix/442-php-use-clause-scope | Carries Hiro-Chiba #442 + clause-scoping/DoS fixes; tip `83b9be4` |
| #447 | fix/ingest-dir-confinement | New: confine discovered files to the directory being ingested |

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

> Alot1z-owned upstream PR: **#448** (fix(php): capture grouped use imports,
> head `5efd8f1`, open 2026-08-16). Additional upstream PRs require
> authorization from the controlling workflow. One fork-only reference branch
> exists (see below).

### 0701040 / 83b9be4 — duplicate-fix case (recorded 2026-08-15T07:47Z)

PR #446's tip `83b9be4` (KageBinary) fixes the multi-namespace guard by adding
parser-level `phpNamespaceBlocks` metadata counted during the single parse walk.

A fork branch `fix/446-multi-namespace-guard` (tip `0701040`, Alot1z) implements
the SAME two edge cases by counting namespace `kind:'module'` entities minus
import-use modules in `resolveEdges` — an entity-inference approach.

**Disposition:** `83b9be4` is the authoritative fix (parser-derived metadata is
more robust than inferring semantics from generated entities). `0701040` is
independent-validation evidence only — do NOT open a competing PR from it. The
branch is preserved on the fork as historical provenance. A reference comment
exists on #446 describing the alternative; it defers to maintainers.

### Approvals since last refresh
- **#428** fix(mcp): mark smells as mutating — APPROVED (Hiro-Chiba)
- **#432** fix(mcp): reject conflicting ingest sources — APPROVED (Hiro-Chiba)
- **#438** fix(cli): validate pick options consistently — APPROVED (Hiro-Chiba; replaces #430)
- All others: REVIEW_REQUIRED (mergeStateStatus=BLOCKED across the board — branch protection / status checks still running)

### Supersession chains (maintainer-confirmed via PR bodies, no bookkeeping comments)
The earlier supersession/provenance comments were REMOVED as bookkeeping noise
(see AGENTS.md comment policy — supersession records and provenance locks are
forbidden). Current live comment state (verified 2026-08-15T07:47Z):

| PR | Live comments (2026-08-16) |
|---|---|
| #434 | 2 × KageBinary (review + "#443 carries your commits") |
| #436 | 2 × KageBinary (review + "#444 carries your commits") |
| #440 | 3 × KageBinary (review + memoize + "#445 carries your commits") |
| #442 | 3 × KageBinary (review + regressions + "#446 carries your commits") |
| #443 | 1 × Alot1z technical (F-016, `5305054711`) |
| #444 | none |
| #445 | 1 × KageBinary (symlink-gap commit) + 1 × Alot1z technical (F-017, `5305054778`) |
| #446 | 1 × KageBinary (83b9be4 re-audit) + Alot1z (F-014 `5303306410`, F-019 `5305054642`) |

**Supersession chains confirmed (by KageBinary in PR bodies):**
- Hiro-Chiba #434 → KageBinary #443 (default-import guard)
- Hiro-Chiba #436/#426 → KageBinary #444 (truncated failure reason)
- Hiro-Chiba #440 → KageBinary #445 (authority + security hardening)
- Hiro-Chiba #442 → KageBinary #446 (clause-scoping + DoS hardening)

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
2. **GitHub write policy** — no pushes to upstream, no GitHub writes without per-action authorization; bookkeeping comments (supersession records, provenance locks, status notes) are FORBIDDEN — post only genuine technical findings
3. **Verification before claims** — run tests before claiming verification; never fabricate references

This fork-local agent system builds ON these rules, adding them as constraints to every specialist agent definition.

## Skill Ecosystem Used

Primary: `ix` (codebase intelligence via Ix CLI graph), `using-agent-skills` (skill discovery), `orchestration` (multi-agent coordination patterns), skill-authoring workflow from `system-connector`.
Supporting: `parasite-skill` (skill routing, compose, scan).

## PR-Audit Era 2026-08-15/16 — F-014..F-021

Adversarial audit of all open PRs (#434–#448) found five live, maintainer-worthy
defects; each was reproduced against the current upstream state, fixed with a
minimal verified commit on a fork branch (parent aligned to the current PR
head), published to `Alot1z/Ix-remap`, and surfaced (comment or PR). Full
registry: `Alot1z/Ix-findings` `planning/findings/registry.json` + `PR-AUDIT-2026-08-15.md`.

| Finding | Bug | Fix commit (parent) | Communication |
|---|---|---|---|
| F-014 | #446 global↔namespace scope-boundary regression → wrong CALLS @0.9 | `0a7d97f` (parent #446 head `83b9be4`) | #446 comment `5303306410` |
| F-019 | #446 FQCN map drops same-line sibling types → NONE | `f577492` (parent `0a7d97f`) | #446 comment `5305054642` |
| F-016 | #443 renamed-import fallback binds to provider member → wrong EXTENDS | `cba11a3` (parent #443 head `eab1075`) | #443 comment `5305054711` |
| F-017 | #445 configured-mapping path same defect | `f9274cc` (parent #445 head `adc97c1`) | #445 comment `5305054778` |
| F-021 | main: grouped `use Vendor\{A, B};` captures zero IMPORTS | `5efd8f1` (parent `043bc68`) | **PR #448** (open) |

Recorded but not contributed: F-015 (pre-existing C7 use-leak, needs
namespace-aware fallback), F-020 (single-char names, deliberate noise filter,
low value), F-018 (upstream guard, informational), N-003 (#444/#447 audited
clean). Duplicate-fix doctrine and pipeline rules are encoded in
`Alot1z/Ix-findings/AGENTS.md` + `knowledge.md` (2026-08-16).

Tool availability (honest): Ix CLI binary AVAILABLE; Ix backend/graph
UNAVAILABLE (Docker down — never fake graph results); `.agents/` subagents
UNAVAILABLE as spawned processes here (methodologies applied directly);
RavelScope UNAVAILABLE for TS/tree-sitter (binary toolchain).