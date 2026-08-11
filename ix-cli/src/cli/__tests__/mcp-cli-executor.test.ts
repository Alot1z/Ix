import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliToolExecutor } from "../mcp/cli-executor.js";
import { findTool } from "../mcp/tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const slowFixture = join(here, "fixtures", "mcp-slow-fixture.mjs");
const cliFixture = join(here, "fixtures", "mcp-cli-fixture.mjs");

describe("CliToolExecutor (real child processes)", () => {
  it("captures llm output from a successful command", async () => {
    const executor = new CliToolExecutor({ cliMain: cliFixture });
    const result = await executor.run(findTool("ix_map")!, { path: "/tmp/x" }, {
      timeoutMs: 5000,
      cwd: process.cwd(),
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("mock map rev=1");
  });

  it("kills a hung child on timeout and reports timedOut", async () => {
    const executor = new CliToolExecutor({ cliMain: slowFixture });
    const result = await executor.run(findTool("ix_status")!, {}, {
      timeoutMs: 500,
      cwd: process.cwd(),
    });
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  }, 15_000);

  it("passes exactly the whitelisted argv to the child", async () => {
    const executor = new CliToolExecutor({ cliMain: cliFixture });
    const result = await executor.run(findTool("ix_read")!, { target: "src/main.ts", pick: 2 }, {
      timeoutMs: 5000,
      cwd: process.cwd(),
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("mock read rev=1");
  });

  it("defaults the CLI entry to IX_MCP_CLI_MAIN when set", () => {
    const previous = process.env.IX_MCP_CLI_MAIN;
    process.env.IX_MCP_CLI_MAIN = cliFixture;
    try {
      const executor = new CliToolExecutor();
      expect(executor.cliMain).toBe(cliFixture);
    } finally {
      if (previous === undefined) delete process.env.IX_MCP_CLI_MAIN;
      else process.env.IX_MCP_CLI_MAIN = previous;
    }
  });
});
