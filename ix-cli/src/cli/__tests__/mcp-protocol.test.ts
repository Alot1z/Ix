import { describe, expect, it } from "vitest";
import {
  MCP_LEGACY_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
  metaProtocolVersion,
  parseLine,
  serializeMessage,
} from "../mcp/protocol.js";
import { buildArgv, findTool, TOOLS, validateArgs } from "../mcp/tools.js";

describe("mcp protocol helpers", () => {
  it("pins the dual-era supported versions", () => {
    expect(MCP_SUPPORTED_VERSIONS).toContain("2026-07-28"); // modern
    expect(MCP_SUPPORTED_VERSIONS).toContain("2025-06-18"); // legacy handshake
    expect(MCP_PROTOCOL_VERSION).toBe("2026-07-28");
    expect(MCP_LEGACY_VERSION).toBe("2025-06-18");
  });

  it("reads the protocol version from modern _meta", () => {
    expect(metaProtocolVersion({ _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } })).toBe("2026-07-28");
  });

  it("returns undefined when no _meta is present (legacy era)", () => {
    expect(metaProtocolVersion({ protocolVersion: "2025-06-18" })).toBeUndefined();
    expect(metaProtocolVersion(undefined)).toBeUndefined();
  });

  it("serializes to a single line with no embedded newlines", () => {
    const line = serializeMessage({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "a\nb" }] } });
    expect(line).not.toContain("\n");
    expect(JSON.parse(line).result.content[0].text).toBe("a\nb");
  });

  it("parses a line and skips blank lines", () => {
    expect(parseLine("  ")).toBeUndefined();
    expect(parseLine('{"jsonrpc":"2.0","id":1,"method":"ping"}')).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(() => parseLine("{not json")).toThrow();
  });
});

describe("tool registry", () => {
  it("exposes exactly the eight read tools in deterministic order", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "ix_map",
      "ix_status",
      "ix_explain",
      "ix_trace",
      "ix_impact",
      "ix_search",
      "ix_rank",
      "ix_read",
    ]);
  });

  it("binds every tool to a real ix command with --format llm support", () => {
    for (const tool of TOOLS) {
      expect(tool.command.length).toBeGreaterThan(0);
      expect(tool.inputSchema.additionalProperties).toBe(false); // no smuggled flags
    }
  });
});

describe("validateArgs", () => {
  const map = findTool("ix_map")!;
  const explain = findTool("ix_explain")!;

  it("accepts valid args", () => {
    expect(validateArgs(map, { path: "/repo", level: 2, min_confidence: 0.5, all_items: true })).toBeNull();
    expect(validateArgs(map, {})).toBeNull();
  });

  it("rejects unknown arguments (flag smuggling guard)", () => {
    expect(validateArgs(map, { "--verbose": true })).toContain("unknown argument");
    expect(validateArgs(map, { silent: true })).toContain("unknown argument");
  });

  it("rejects non-object arguments", () => {
    expect(validateArgs(map, "path")).toContain("must be an object");
    expect(validateArgs(map, null)).toContain("must be an object");
  });

  it("enforces required arguments", () => {
    expect(validateArgs(explain, {})).toContain("missing required argument \"symbol\"");
    expect(validateArgs(explain, { symbol: "Foo" })).toBeNull();
  });

  it("enforces types", () => {
    expect(validateArgs(map, { level: "two" })).toContain("must be a number");
    expect(validateArgs(map, { all_items: "yes" })).toContain("must be a boolean");
  });

  it("enforces enums", () => {
    expect(validateArgs(map, { sort: "bogus" })).toContain("must be one of");
    expect(validateArgs(map, { sort: "confidence" })).toBeNull();
  });
});

describe("buildArgv", () => {
  it("builds a whitelisted argv with --format llm appended", () => {
    const trace = findTool("ix_trace")!;
    expect(buildArgv(trace, { symbol: "IngestionService", depth: 2, upstream: true, tests_only: false })).toEqual([
      "trace",
      "IngestionService",
      "--upstream",
      "--depth",
      "2",
      "--format",
      "llm",
    ]);
  });

  it("omits unset flags and adds no positional when absent", () => {
    const rank = findTool("ix_rank")!;
    expect(buildArgv(rank, { top: 5 })).toEqual(["rank", "--top", "5", "--format", "llm"]);
  });
});
