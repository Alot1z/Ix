import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerOssCommands, registerProStubs } from "../register/oss.js";

function buildProgram(): Command {
  const program = new Command();
  program.name("ix").exitOverride();
  registerOssCommands(program);
  return program;
}

async function runMcp(args: string[]): Promise<string> {
  const program = buildProgram();
  const output: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    output.push(values.join(" "));
  });
  try {
    await program.parseAsync(["node", "ix", "mcp", ...args]);
  } finally {
    log.mockRestore();
  }
  return output.join("\n");
}

describe("ix mcp registration (F-009 guard)", () => {
  it("registers mcp in the OSS command surface", () => {
    const program = buildProgram();
    const mcp = program.commands.find((c) => c.name() === "mcp");
    expect(mcp).toBeDefined();
    expect(mcp!.description()).toContain("MCP");
  });

  it("is never shadowed by a Pro stub — the F-009 regression guard", () => {
    // F-009: `patches` was never registered, so a Pro stub shadowed it and the
    // real command was unreachable. The mirror guard: after registerProStubs
    // runs, `mcp` must still carry its real description, not the stub's
    // "requires Ix Pro" text.
    const program = buildProgram();
    registerProStubs(program);
    const mcp = program.commands.find((c) => c.name() === "mcp");
    expect(mcp).toBeDefined();
    expect(mcp!.description()).toContain("MCP");
    expect(mcp!.description()).not.toContain("requires Ix Pro");
  });
});

describe("ix mcp --list-tools", () => {
  it("prints the tool registry as JSON with the eight tools", async () => {
    const output = await runMcp(["--list-tools"]);
    const parsed = JSON.parse(output);
    expect(parsed.map((t: { name: string }) => t.name)).toEqual([
      "ix_map",
      "ix_status",
      "ix_explain",
      "ix_trace",
      "ix_impact",
      "ix_search",
      "ix_rank",
      "ix_read",
    ]);
    for (const tool of parsed) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
});
