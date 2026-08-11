/**
 * Protocol-abuse matrix (Phase 9 hardening).
 *
 * Every case must resolve to a defined behavior — a documented error or a
 * correct answer — never a crash, a hang, or unbounded memory. Run against
 * the real McpServer over PassThrough streams so the stdio line reader (the
 * size-capped splitter) is the code under test.
 */

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { McpServer } from "../mcp/server.js";
import { TOOLS } from "../mcp/tools.js";
import type { ToolArgs, ToolDefinition, ToolExecutor, ToolRunOptions, ToolRunResult } from "../mcp/types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await delay(5);
  }
}

/** Executor whose work takes a controlled amount of time (0 = instant). */
class ControlledExecutor implements ToolExecutor {
  inFlight = 0;
  maxConcurrent = 0;

  constructor(private readonly workMs = 0) {}

  async run(_tool: ToolDefinition, _args: ToolArgs, options: ToolRunOptions): Promise<ToolRunResult> {
    this.inFlight++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    try {
      await new Promise<void>((resolve) => {
        const finish = () => resolve();
        const timer = setTimeout(finish, this.workMs);
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      const cancelled = options.signal?.aborted ?? false;
      return cancelled
        ? { ok: false, stdout: "", stderr: "cancelled", code: null, timedOut: false, cancelled: true }
        : { ok: true, stdout: "work done", stderr: "", code: 0, timedOut: false };
    } finally {
      this.inFlight--;
    }
  }
}

function makeSession(executor: ToolExecutor) {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = new McpServer({
    tools: TOOLS,
    executor,
    io: { input, output },
    serverInfo: { name: "ix", version: "0.9.2" },
  });
  const started = server.start();
  const responses: unknown[] = [];
  output.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim() !== "") responses.push(JSON.parse(line));
    }
  });

  async function send(raw: string): Promise<any> {
    const before = responses.length;
    input.write(raw + "\n");
    await waitUntil(() => responses.length > before);
    return responses[responses.length - 1];
  }
  async function close(): Promise<void> {
    input.end();
    await started;
  }
  return { send, close, responses, input };
}

describe("mcp server — protocol abuse matrix", () => {
  it("rejects a line larger than the cap with -32700 and stays alive (memory bound)", async () => {
    const session = makeSession(new ControlledExecutor());
    const n = session.responses.length;
    const pad = "x".repeat(1024 * 1024 + 1); // > 1 MiB default cap
    session.input.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "initialize", params: { pad } }) + "\n");
    await waitUntil(() => session.responses.length > n);
    const res = session.responses[session.responses.length - 1] as any;
    expect(res.error.code).toBe(-32700);
    expect(res.error.message).toContain("Message too large");
    // The reader resynced: the session is still usable.
    const ping = await session.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(ping.id).toBe(1);
    expect(ping.result).toEqual({});
    await session.close();
  });

  it("rejects JSON-RPC batches with a single -32600 (no partial processing)", async () => {
    const session = makeSession(new ControlledExecutor());
    const res = await session.send(
      JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]),
    );
    expect(res.error.code).toBe(-32600);
    expect(res.error.message).toContain("Batch");
    const empty = await session.send(JSON.stringify([]));
    expect(empty.error.code).toBe(-32600);
    await session.close();
  });

  it("tolerates unknown _meta keys on modern requests", async () => {
    const session = makeSession(new ControlledExecutor());
    const res = await session.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "vendor/unknown": { deep: 1 } } },
      }),
    );
    expect(res.result.tools.length).toBeGreaterThan(0);
    await session.close();
  });

  it("rejects a wrong jsonrpc version with -32600", async () => {
    const session = makeSession(new ControlledExecutor());
    const res = await session.send(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }));
    expect(res.error.code).toBe(-32600);
    await session.close();
  });

  it("rejects a non-scalar id with -32600 and a null response id", async () => {
    const session = makeSession(new ControlledExecutor());
    const res = await session.send(JSON.stringify({ jsonrpc: "2.0", id: { nested: 1 }, method: "ping" }));
    expect(res.id).toBeNull();
    expect(res.error.code).toBe(-32600);
    await session.close();
  });

  it("rejects a missing method with -32600", async () => {
    const session = makeSession(new ControlledExecutor());
    const res = await session.send(JSON.stringify({ jsonrpc: "2.0", id: 1 }));
    expect(res.error.code).toBe(-32600);
    await session.close();
  });

  it("rejects tools/call with non-object params via -32602", async () => {
    const session = makeSession(new ControlledExecutor());
    const res = await session.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: "nope" }));
    expect(res.error.code).toBe(-32602);
    expect(res.error.message).toContain("requires a tool name");
    await session.close();
  });

  it("handles concurrent cancels for one in-flight call without crashing", async () => {
    const executor = new ControlledExecutor(10_000);
    const session = makeSession(executor);
    const n = session.responses.length;
    session.input.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ix_map", arguments: {} } }) + "\n");
    await delay(30); // let the call start and register as pending
    session.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } }) + "\n");
    session.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } }) + "\n");
    await waitUntil(() => session.responses.length > n);
    const res = session.responses[session.responses.length - 1] as any;
    expect(res.id).toBe(7);
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("cancelled");
    // Server still healthy after the double cancel.
    const ping = await session.send(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "ping" }));
    expect(ping.id).toBe(8);
    await session.close();
  });

  it("answers a ping sent during a long call only after it — sequential queue, no deadlock", async () => {
    const executor = new ControlledExecutor(200);
    const session = makeSession(executor);
    session.input.write(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "ix_map", arguments: {} } }) + "\n");
    await delay(30);
    session.input.write(JSON.stringify({ jsonrpc: "2.0", id: 10, method: "ping" }) + "\n");
    await waitUntil(() => session.responses.length >= 2);
    const ids = session.responses.map((r) => (r as any).id);
    expect(ids).toContain(9);
    expect(ids).toContain(10);
    expect(ids.indexOf(10)).toBeGreaterThan(ids.indexOf(9)); // strictly sequential
    expect(executor.maxConcurrent).toBe(1); // never two tools at once
    await session.close();
  });

  it("survives a notification storm and keeps answering real requests", async () => {
    const session = makeSession(new ControlledExecutor());
    const n = session.responses.length;
    for (let i = 0; i < 100; i++) {
      session.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    }
    await delay(50);
    expect(session.responses.length).toBe(n); // no responses to notifications
    const ping = await session.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(ping.id).toBe(1);
    await session.close();
  });

  it("treats a second initialize as idempotent", async () => {
    const session = makeSession(new ControlledExecutor());
    const handshake = (id: number) =>
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "abuser", version: "1.0.0" } },
      });
    const r1 = await session.send(handshake(1));
    const r2 = await session.send(handshake(2));
    expect(r1.result.protocolVersion).toBe("2025-06-18");
    expect(r2.result.protocolVersion).toBe("2025-06-18");
    await session.close();
  });

  it("does not hang on a partial frame at EOF", async () => {
    const session = makeSession(new ControlledExecutor());
    session.input.write("{definitely not a complete message");
    const startedAt = Date.now();
    await session.close();
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(session.responses.length).toBe(0); // nothing dispatchable, nothing written
  });
});
