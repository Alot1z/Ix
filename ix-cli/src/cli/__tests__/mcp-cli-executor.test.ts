import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliToolExecutor } from "../mcp/cli-executor.js";
import { findTool } from "../mcp/tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const slowFixture = join(here, "fixtures", "mcp-slow-fixture.mjs");
const cliFixture = join(here, "fixtures", "mcp-cli-fixture.mjs");
const grandchildFixture = join(here, "fixtures", "mcp-grandchild-fixture.mjs");

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

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

  it("reaps grandchildren when a call times out (no orphans)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ix-mcp-grand-"));
    const grandPidFile = join(dir, "grand.pid");
    const previous = process.env.IX_MCP_TEST_GRAND_PID;
    process.env.IX_MCP_TEST_GRAND_PID = grandPidFile;
    try {
      const executor = new CliToolExecutor({ cliMain: grandchildFixture });
      const runPromise = executor.run(findTool("ix_status")!, {}, { timeoutMs: 3000, cwd: process.cwd() });
      // The fixture spawns a grandchild and records its PID; wait for it so
      // the assertion below can prove the tree died, not just the direct
      // child.
      await waitFor(() => existsSync(grandPidFile), 10_000);
      const grandPid = Number(readFileSync(grandPidFile, "utf8"));
      expect(processAlive(grandPid)).toBe(true);
      const result = await runPromise;
      expect(result.timedOut).toBe(true);
      await waitFor(() => !processAlive(grandPid), 10_000);
    } finally {
      if (previous === undefined) delete process.env.IX_MCP_TEST_GRAND_PID;
      else process.env.IX_MCP_TEST_GRAND_PID = previous;
    }
  }, 30_000);

  it("disposeAll() kills in-flight children and their grandchildren on shutdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ix-mcp-dispose-"));
    const grandPidFile = join(dir, "grand.pid");
    const ownPidFile = join(dir, "own.pid");
    const previousG = process.env.IX_MCP_TEST_GRAND_PID;
    const previousO = process.env.IX_MCP_TEST_OWN_PID;
    process.env.IX_MCP_TEST_GRAND_PID = grandPidFile;
    process.env.IX_MCP_TEST_OWN_PID = ownPidFile;
    try {
      const executor = new CliToolExecutor({ cliMain: grandchildFixture });
      const runPromise = executor.run(findTool("ix_status")!, {}, { timeoutMs: 60_000, cwd: process.cwd() });
      await waitFor(() => existsSync(ownPidFile) && existsSync(grandPidFile), 10_000);
      const ownPid = Number(readFileSync(ownPidFile, "utf8"));
      const grandPid = Number(readFileSync(grandPidFile, "utf8"));
      executor.disposeAll();
      const result = await runPromise;
      expect(result.ok).toBe(false); // killed before completing
      await waitFor(() => !processAlive(ownPid), 10_000);
      await waitFor(() => !processAlive(grandPid), 10_000);
    } finally {
      if (previousG === undefined) delete process.env.IX_MCP_TEST_GRAND_PID;
      else process.env.IX_MCP_TEST_GRAND_PID = previousG;
      if (previousO === undefined) delete process.env.IX_MCP_TEST_OWN_PID;
      else process.env.IX_MCP_TEST_OWN_PID = previousO;
    }
  }, 30_000);
});
