/**
 * Real-process stdio integration test.
 *
 * Spawns the actual MCP server entry (src/cli/mcp/stdio-main.ts) under tsx,
 * with IX_MCP_CLI_MAIN pointing at a deterministic fixture CLI, then drives a
 * full protocol session over real pipes: initialize → tools/list →
 * tools/call → ping → EOF. This exercises the stdio framing (newline-delimited
 * JSON-RPC), the process lifecycle, and the tool executor end to end — with
 * no backend required.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsxCli = join(here, "..", "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(here, "fixtures", "mcp-server-entry.ts");
const fixture = join(here, "fixtures", "mcp-cli-fixture.mjs");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean, timeoutMs = 45_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await delay(10);
  }
}

it("serves a full dual-era stdio session against the real entry", { timeout: 120_000 }, async () => {
  const child = spawn(process.execPath, [tsxCli, entry], {
    env: { ...process.env, IX_MCP_CLI_MAIN: fixture },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  const lines: string[] = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim() !== "") lines.push(part);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  try {
    // 1. Legacy initialize handshake.
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "integration", version: "1.0.0" } },
    }) + "\n");
    await waitUntil(() => lines.length >= 1);
    const init = JSON.parse(lines[0]);
    expect(init.id).toBe(1);
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toEqual({ listChanged: false });

    // 2. Modern server/discover.
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "server/discover" }) + "\n");
    await waitUntil(() => lines.length >= 2);
    const discover = JSON.parse(lines[1]);
    expect(discover.result.resultType).toBe("complete");
    expect(discover.result.supportedVersions).toContain("2026-07-28");

    // 3. tools/list.
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }) + "\n");
    await waitUntil(() => lines.length >= 3);
    const list = JSON.parse(lines[2]);
    expect(list.result.tools).toHaveLength(8);

    // 4. tools/call through the fixture executor (real child process).
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "ix_map", arguments: { path: "/tmp/x" } },
    }) + "\n");
    await waitUntil(() => lines.length >= 4);
    const call = JSON.parse(lines[3]);
    expect(call.id).toBe(4);
    expect(call.result.isError).toBe(false);
    expect(call.result.content[0].text).toContain("mock map rev=1");

    // 5. ping (legacy liveness).
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "ping" }) + "\n");
    await waitUntil(() => lines.length >= 5);
    expect(JSON.parse(lines[4]).result).toEqual({});

    // 6. EOF → clean exit 0.
    child.stdin.end();
  } finally {
    try {
      child.stdin.end();
    } catch {
      // stdin already closed
    }
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already exited
      }
      resolve(null);
    }, 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  expect(exitCode, `server stderr: ${stderr}`).toBe(0);
  expect(stderr).not.toContain("Error:");
});
