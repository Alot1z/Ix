# Consolidating the per-host plugins onto `ix mcp`

Ix ships six per-host plugin repos, each with its own tool implementation:
`ix-claude-plugin`, `ix-codex-plugin`, `ix-cursor-plugin`, `ix-gemini-plugin`,
`ix-openclaw-plugin`, `ix-opencode-plugin`. `ix mcp` serves the same graph tools
from the CLI, so those implementations can be retired in favour of one server.

This is what that costs and in what order it can happen.

## What MCP can and cannot absorb

Measured across the six repos (source only, excluding `node_modules` and `dist`):

| Layer | Lines | Absorbed by `ix mcp`? |
|---|---:|---|
| Tool implementations (`mcp/`, `tools/`, `runtime/`) | ~15,300 | **Yes** |
| Agents, hooks, skills, commands, rules | ~10,600 | **No** |

MCP standardizes tools, resources and prompts. It has no concept of a hook, a
skill, a slash command or a host instruction file, so roughly 40% of what the
plugins do has no MCP equivalent and stays host-specific whatever else happens.
Consolidation retires the tool layer; it does not retire the plugins.

## Tool-surface parity

The plugins never shared one tool surface. Measured against `ix mcp`:

| Plugin | Tools | Tools `ix mcp` lacked |
|---|---:|---|
| ix-codex-plugin | 23 | — |
| ix-cursor-plugin | 23 | — |
| ix-gemini-plugin | 23 | `ix_decide`, `ix_ingest`, `ix_query`, `ix_status` |
| ix-openclaw-plugin | 17 | `ix_decide`, `ix_docs_tool`, `ix_ingest`, `ix_neighbors`, `ix_query` |
| ix-opencode-plugin | 17 | `ix_decide`, `ix_docs_tool`, `ix_ingest`, `ix_neighbors`, `ix_query` |
| ix-claude-plugin | 0 (skills only) | — |

`ix mcp` now closes that gap, with three deliberate exclusions:

- **`ix_query`** — the deprecated command the CLI docs tell agents not to use
  ("produces oversized low-signal responses"). Dropped on purpose.
- **`ix_neighbors`** — a composite of `ix_callers` + `ix_callees` + `ix_depends`,
  all served individually. Callers lose one round-trip, not a capability.
- **`ix_docs_tool`** — a composite over `ix_overview`, likewise served.

And `ix_status` is Gemini's name for what `ix mcp` calls `ix_health`; both run
`ix status`.

`ix_decide` and `ix_ingest` were real gaps and are now served. `ix_decide` is a
write and needs Pro, so it is advertised only when `@ix/pro` resolves — as are
`ix_briefing` and `ix_decisions`, which this server previously offered to every
install even though every call answered "requires Ix Pro".

**Net:** codex and cursor can delegate with no change in what an agent can do.
gemini, openclaw and opencode lose only `ix_query` and the two composites.

## Structured results and tool annotations

`ix mcp` exposes two protocol conveniences on top of the tool surface:

- **Tool annotations.** Every advertised tool carries `readOnlyHint`,
  `destructiveHint`, `idempotentHint` and `openWorldHint` so a client can
  present and route it correctly. Graph reads are read-only and idempotent;
  `ix_map`, `ix_ingest` and `ix_decide` are destructive because they mutate
  backend state; only `ix_ingest` is open-world, because its GitHub form
  reaches an external API. These are advisory hints, not security controls —
  the enforcement that matters (argv construction, timeouts, output bounds,
  process cleanup) lives in the runner.

- **Structured content.** `ix_map`, `ix_ingest` and `ix_smells` return their
  parsed JSON object as `structuredContent` (with an `outputSchema`) so agents
  receive typed values instead of a string to re-parse. The schema asserts only
  "an object": the real field shape is backend-defined and versioned, and
  promising specific fields would break tool calls the moment the backend
  renames one. The human-readable text result is preserved for clients that
  prefer it. The remaining tools return their `llm`-format text, which has no
  stable object shape worth promising.

## Order of work

1. **Ship `ix mcp` in a released `@ix/cli`.** Nothing downstream can depend on it
   until then. The plugins already gate features on CLI version floors, so this
   becomes a new floor.
2. **Point each plugin's registration at `ix mcp`** instead of its own server,
   and delete that server. Start with codex and cursor — those two are lossless.
3. **Leave agents, hooks, skills and commands where they are.** They are the
   plugins' remaining reason to exist.

Step 2 is one PR per repo and each is independently revertible; a plugin that has
not migrated keeps working, because `ix mcp install` refuses to take a name that
another server already holds.
