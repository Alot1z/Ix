/**
 * The `ix mcp` tool registry.
 *
 * Every tool maps to a real `ix` CLI command and is backed by the command's
 * own `--format llm` machine output (see docs/llm-format.md). Tools are
 * read-only queries against the code graph; the graph-mutating write surface
 * (`remap`) is deliberately absent until it exists on the base this server
 * ships on — the `/__ix/remap` endpoint is added by an unmerged hardening PR,
 * and inventing a tool that shells out to a command that does not exist would
 * violate the no-fabrication rule. A write tool can be added in a later phase
 * once the endpoint is merged upstream.
 *
 * Tool names follow the spec's character rules ([A-Za-z0-9_-]) and are
 * prefixed with `ix_` so an aggregating client never collides with another
 * server's `search`/`rank`/`status` tools.
 */

import type { ToolDefinition, ToolArgs } from "./types.js";

/** Read tools: `ix <command>` with its positional argument, if any. */
export const TOOLS: ToolDefinition[] = [
  {
    name: "ix_map",
    description:
      "Map the architectural hierarchy of a codebase. Returns the region hierarchy (system → subsystem → module) with cohesion, coupling, and confidence scores per region. Use to understand a repository's overall structure before drilling into symbols.",
    command: "map",
    positional: { property: "path", required: false, flag: "path" },
    flags: [
      { property: "level", flag: "--level", kind: "number" },
      { property: "min_confidence", flag: "--min-confidence", kind: "number" },
      { property: "max_items", flag: "--max-items", kind: "number" },
      { property: "sort", flag: "--sort", kind: "string" },
      { property: "all_items", flag: "--all-items", kind: "boolean" },
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Repository path to map (absolute, or relative to the server's working directory). Defaults to the working directory.",
        },
        level: { type: "number", description: "Only show regions at this level (1=module, 2=subsystem, 3=system)." },
        min_confidence: { type: "number", description: "Only show regions above this confidence threshold (0-1)." },
        max_items: { type: "number", description: "Max items to show per section (default 10)." },
        sort: { type: "string", enum: ["importance", "confidence", "size", "alpha"], description: "Sort mode." },
        all_items: { type: "boolean", description: "Show all items instead of capping per section." },
      },
    },
  },
  {
    name: "ix_status",
    description:
      "Report whether the ix backend is reachable, its health, and whether the code graph is stale. Use as a cheap first check before other tools.",
    command: "status",
    flags: [{ property: "root", flag: "--root", kind: "string" }],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        root: { type: "string", description: "Workspace root directory to check." },
      },
    },
  },
  {
    name: "ix_explain",
    description:
      "Explain what a symbol is, what role it plays, and why it matters. Resolves the entity from the code graph and returns its role, importance, and collected facts. Use for 'what is X / what does X do' questions about a class, function, or module.",
    command: "explain",
    positional: { property: "symbol", required: true, flag: "symbol" },
    flags: [
      { property: "kind", flag: "--kind", kind: "string" },
      { property: "path", flag: "--path", kind: "string" },
      { property: "pick", flag: "--pick", kind: "number" },
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        symbol: { type: "string", description: "Symbol name to explain (e.g. a class or function name)." },
        kind: { type: "string", description: "Filter the resolved target by entity kind." },
        path: { type: "string", description: "Prefer symbols from files matching this path substring." },
        pick: { type: "number", description: "Pick Nth candidate from ambiguous results (1-based)." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "ix_trace",
    description:
      "Trace how a symbol flows through the codebase: what calls/imports it (upstream) and what it calls/imports (downstream), bounded by depth. Use for call-graph and dependency questions.",
    command: "trace",
    positional: { property: "symbol", required: true, flag: "symbol" },
    flags: [
      { property: "to", flag: "--to", kind: "string" },
      { property: "upstream", flag: "--upstream", kind: "boolean" },
      { property: "downstream", flag: "--downstream", kind: "boolean" },
      { property: "kind", flag: "--kind", kind: "string" },
      { property: "depth", flag: "--depth", kind: "number" },
      { property: "cap", flag: "--cap", kind: "number" },
      { property: "pick", flag: "--pick", kind: "number" },
      { property: "path", flag: "--path", kind: "string" },
      { property: "include_tests", flag: "--include-tests", kind: "boolean" },
      { property: "tests_only", flag: "--tests-only", kind: "boolean" },
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        symbol: { type: "string", description: "Symbol name to trace." },
        to: { type: "string", description: "Find a path to this target symbol." },
        upstream: { type: "boolean", description: "Show who calls/imports this symbol." },
        downstream: { type: "boolean", description: "Show what this symbol calls/imports." },
        kind: { type: "string", enum: ["calls", "imports", "depends", "contains"], description: "Relationship kind." },
        depth: { type: "number", description: "Cap traversal depth." },
        cap: { type: "number", description: "Cap number of nodes visited, per direction." },
        pick: { type: "number", description: "Pick Nth candidate from ambiguous results (1-based)." },
        path: { type: "string", description: "Prefer symbols from files matching this path substring." },
        include_tests: { type: "boolean", description: "Include test and fixture entities." },
        tests_only: { type: "boolean", description: "Show only test and fixture entities." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "ix_impact",
    description:
      "Estimate the blast radius of changing a symbol: which other entities are affected and how heavily. Use before proposing a change to understand what could break.",
    command: "impact",
    positional: { property: "symbol", required: true, flag: "symbol" },
    flags: [
      { property: "kind", flag: "--kind", kind: "string" },
      { property: "pick", flag: "--pick", kind: "number" },
      { property: "depth", flag: "--depth", kind: "number" },
      { property: "limit", flag: "--limit", kind: "number" },
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        symbol: { type: "string", description: "Symbol name whose impact to measure." },
        kind: { type: "string", description: "Filter target entity by kind." },
        pick: { type: "number", description: "Pick Nth candidate from ambiguous results (1-based)." },
        depth: { type: "number", description: "Expansion depth for callers/importers (default 1, max 3)." },
        limit: { type: "number", description: "Max top-impacted members to show." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "ix_search",
    description:
      "Search the code graph for entities by name or kind. Returns matching entities with their type, file, and a snippet of context. Use to find where a symbol is defined or to enumerate entities of a kind.",
    command: "search",
    positional: { property: "query", required: true, flag: "query" },
    flags: [
      { property: "limit", flag: "--limit", kind: "number" },
      { property: "kind", flag: "--kind", kind: "string" },
      { property: "language", flag: "--language", kind: "string" },
      { property: "path", flag: "--path", kind: "string" },
      { property: "as_of", flag: "--as-of", kind: "string" },
      { property: "include_tests", flag: "--include-tests", kind: "boolean" },
      { property: "tests_only", flag: "--tests-only", kind: "boolean" },
      { property: "semantic", flag: "--semantic", kind: "boolean" },
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Search query (symbol name or fragment)." },
        limit: { type: "number", description: "Max results." },
        kind: { type: "string", description: "Filter and boost results by node kind (e.g. class, function, decision)." },
        language: { type: "string", description: "Filter by language/file extension (e.g. scala, ts)." },
        path: { type: "string", description: "Boost results from files matching this path substring." },
        as_of: { type: "string", description: "Search as of a specific revision." },
        include_tests: { type: "boolean", description: "Include test and fixture entities in results." },
        tests_only: { type: "boolean", description: "Show only test and fixture entities." },
        semantic: { type: "boolean", description: "Use vector-similarity search instead of keyword matching." },
      },
      required: ["query"],
    },
  },
  {
    name: "ix_rank",
    description:
      "Rank entities by importance (dependents, coupling, centrality) to find hotspots — the files most depended on, most coupled, or most likely to be change bottlenecks.",
    command: "rank",
    flags: [
      { property: "top", flag: "--top", kind: "number" },
      { property: "path", flag: "--path", kind: "string" },
      { property: "exclude_path", flag: "--exclude-path", kind: "string" },
      { property: "exclude_kind", flag: "--exclude-kind", kind: "string" },
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        top: { type: "number", description: "Number of results to return." },
        path: { type: "string", description: "Filter entities by source path substring." },
        exclude_path: { type: "string", description: "Exclude entities whose source path contains this substring." },
        exclude_kind: { type: "string", description: "Comma-separated kinds to exclude." },
      },
    },
  },
  {
    name: "ix_read",
    description:
      "Read actual source code from the code graph: a file range (path:start-end), a symbol's definition, or a resolved target. Returns file metadata plus the raw source lines. Use when you need the code itself, not just structure.",
    command: "read",
    positional: { property: "target", required: true, flag: "target" },
    flags: [
      { property: "kind", flag: "--kind", kind: "string" },
      { property: "path", flag: "--path", kind: "string" },
      { property: "pick", flag: "--pick", kind: "number" },
      { property: "root", flag: "--root", kind: "string" },
    ],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: {
          type: "string",
          description: "Target to read: a path with an optional line range (src/auth.py:10-50) or a symbol name.",
        },
        kind: { type: "string", description: "Filter symbol by kind." },
        path: { type: "string", description: "Prefer symbols from files matching this path substring." },
        pick: { type: "number", description: "Pick Nth candidate from ambiguous results (1-based)." },
        root: { type: "string", description: "Workspace root directory." },
      },
      required: ["target"],
    },
  },
];

const toolByName = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Deterministic order for tools/list (stable across requests — spec SHOULD). */
export function listTools(): ToolDefinition[] {
  return TOOLS;
}

export function findTool(name: string): ToolDefinition | undefined {
  return toolByName.get(name);
}

/** Per-tool wall-clock budget for the spawned CLI, in milliseconds. */
export function toolTimeoutMs(tool: ToolDefinition): number {
  // map can legitimately run for minutes on large systems (the view server
  // gives it 30 min). Everything else answers in seconds.
  const defaultMs = tool.command === "map" ? 300_000 : 120_000;
  const envName = `IX_MCP_${tool.command.toUpperCase().replaceAll("-", "_")}_TIMEOUT_MS`;
  const raw = process.env[envName];
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return defaultMs;
}

/**
 * Validate `arguments` against a tool's input schema without pulling in a
 * JSON-Schema dependency (the CLI's runtime deps are deliberately small).
 * Returns a human-readable problem, or null when the args are valid.
 *
 * Only validated arguments ever reach the CLI: the schema declares
 * `additionalProperties: false`, so a client cannot smuggle arbitrary flags
 * into the spawned command.
 */
export function validateArgs(tool: ToolDefinition, args: unknown): string | null {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return "arguments must be an object";
  }
  const record = args as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(key in tool.inputSchema.properties)) {
      return `unknown argument "${key}"`;
    }
  }

  for (const required of tool.inputSchema.required ?? []) {
    if (!(required in record) || record[required] === null || record[required] === undefined) {
      return `missing required argument "${required}"`;
    }
  }

  for (const [key, raw] of Object.entries(record)) {
    if (raw === null || raw === undefined) continue;
    const prop = tool.inputSchema.properties[key];
    if (!prop) continue;
    const problem = validateProperty(key, prop, raw);
    if (problem) return problem;
  }
  return null;
}

interface SchemaProperty {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  description?: string;
}

function validateProperty(key: string, prop: SchemaProperty, value: unknown): string | null {
  if (prop.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return `argument "${key}" must be a number`;
    }
    if (prop.minimum !== undefined && (value as number) < prop.minimum) {
      return `argument "${key}" must be >= ${prop.minimum}`;
    }
    if (prop.maximum !== undefined && (value as number) > prop.maximum) {
      return `argument "${key}" must be <= ${prop.maximum}`;
    }
  } else if (prop.type === "boolean") {
    if (typeof value !== "boolean") return `argument "${key}" must be a boolean`;
  } else if (prop.type === "string") {
    if (typeof value !== "string") return `argument "${key}" must be a string`;
    if (prop.enum && !prop.enum.includes(value)) {
      return `argument "${key}" must be one of: ${prop.enum.join(", ")}`;
    }
  }
  return null;
}

/**
 * Build the argument vector for a tool call. The output is a plain argv list
 * handed to execFile — never a shell string — so a malicious argument cannot
 * reach a shell even if it slips past validation.
 */
export function buildArgv(tool: ToolDefinition, args: ToolArgs): string[] {
  const argv: string[] = [tool.command];

  if (tool.positional) {
    const value = args[tool.positional.property];
    if (value !== undefined && value !== null) argv.push(String(value));
    // Missing required positional is already rejected by validateArgs.
  }

  for (const flag of tool.flags) {
    const value = args[flag.property];
    if (value === undefined || value === null) continue;
    if (flag.kind === "boolean") {
      if (value === true) argv.push(flag.flag);
    } else {
      argv.push(flag.flag, String(value));
    }
  }

  argv.push("--format", "llm");
  return argv;
}

export type { ToolArgs };
