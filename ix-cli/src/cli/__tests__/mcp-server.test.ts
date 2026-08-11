import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { McpServer } from "../mcp/server.js";
import { TOOLS } from "../mcp/tools.js";
import type { ToolArgs, ToolDefinition, ToolExecutor, ToolRunOptions, ToolRunResult } from "../mcp/types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await delay(5);
  }
}

interface RecordedCall {
  tool: ToolDefinition;
  args: ToolArgs;
  options: ToolRunOptions;
}

class StubExecutor implements ToolExecutor {
  calls: RecordedCall[] = [];
  result: ToolRunResult = {
    ok: true,
    stdout: "map rev=1\nregion id=r1 kind=system label=IX level=3 files=12\n",
    stderr: "",
    code: 0,
    timedOut: false,
  };
  failWith: ToolRunResult | null = null;
  /** When set, run() resolves only after the signal aborts (cancellation test). */
  waitForAbort = false;

  async run(tool: ToolDefinition, args: ToolArgs, options: ToolRunOptions): Promise<ToolRunResult> {
    this.calls.push({ tool, args, options });
    if (this.waitForAbort) {
      return new Promise((resolve) => {
        if (options.signal?.aborted) {
          resolve({ ok: false, stdout: "", stderr: "cancelled", code: null, timedOut: false, cancelled: true });
          return;
        }
        options.signal?.addEventListener("abort", () => {
          resolve({ ok: false, stdout: "", stderr: "cancelled", code: null, timedOut: false, cancelled: true });
        }, { once: true });
      });
    }
    if (this.failWith) return this.failWith;
    return this.result;
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
  async function sendNoResponse(raw: string): Promise<void> {
    input.write(raw + "\n");
    await delay(30);
  }
  async function close(): Promise<void> {
    input.end();
    await started;
  }
  return { send, sendNoResponse, close, responses, input };
}

const modernMeta = (version = "2026-07-28") => ({ _meta: { "io.modelcontextprotocol/protocolVersion": version } });

describe("mcp server — dual-era handshake", () => {
  it("serves the legacy initialize handshake with the negotiated version", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
    }));
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe("2025-06-18");
    expect(res.result.capabilities.tools).toEqual({ listChanged: false });
    expect(res.result.serverInfo.name).toBe("ix");
    // Modern responses carry server identity in _meta; legacy ignores it.
    expect(res._meta["io.modelcontextprotocol/serverInfo"].name).toBe("ix");
    await session.close();
  });

  it("serves modern server/discover with supported versions", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "server/discover" }));
    expect(res.result.resultType).toBe("complete");
    expect(res.result.supportedVersions).toContain("2026-07-28");
    expect(res.result.supportedVersions).toContain("2025-06-18");
    expect(res.result.capabilities.tools).toEqual({ listChanged: false });
    await session.close();
  });

  it("rejects a modern request with an unsupported _meta version (-32022)", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: modernMeta("1900-01-01"),
    }));
    expect(res.error.code).toBe(-32022);
    expect(res.error.data.supported).toContain("2026-07-28");
    expect(res.error.data.requested).toBe("1900-01-01");
    await session.close();
  });

  it("answers ping for legacy clients", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" }));
    expect(res.result).toEqual({});
    await session.close();
  });
});

describe("mcp server — tools", () => {
  it("lists the tools in deterministic order for modern clients", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/list",
      params: modernMeta(),
    }));
    expect(res.result.resultType).toBe("complete");
    expect(res.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "ix_map", "ix_status", "ix_explain", "ix_trace", "ix_impact", "ix_search", "ix_rank",
    ]);
    const first = res.result.tools[0];
    expect(first.inputSchema.additionalProperties).toBe(false);
    expect(first.description.length).toBeGreaterThan(20);
    await session.close();
  });

  it("calls a tool and returns its llm output as text content", async () => {
    const executor = new StubExecutor();
    const session = makeSession(executor);
    const res = await session.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "ix_map", arguments: { path: "/tmp/x", level: 2 } },
    }));
    expect(res.result.resultType).toBe("complete");
    expect(res.result.isError).toBe(false);
    expect(res.result.content[0].type).toBe("text");
    expect(res.result.content[0].text).toContain("rev=1");
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].tool.command).toBe("map");
    expect(executor.calls[0].args).toEqual({ path: "/tmp/x", level: 2 });
    expect(executor.calls[0].options.timeoutMs).toBeGreaterThan(0);
    await session.close();
  });

  it("rejects unknown tool names with -32602", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "ix_nope", arguments: {} },
    }));
    expect(res.error.code).toBe(-32602);
    expect(res.error.message).toContain("Unknown tool");
    await session.close();
  });

  it("rejects invalid arguments with -32602", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "ix_map", arguments: { "--verbose": true } },
    }));
    expect(res.error.code).toBe(-32602);
    expect(res.error.message).toContain("unknown argument");
    await session.close();
  });

  it("reports command failures as isError results, not protocol errors", async () => {
    const executor = new StubExecutor();
    executor.failWith = { ok: false, stdout: "", stderr: "Ix backend not reachable at http://localhost", code: 1, timedOut: false };
    const session = makeSession(executor);
    const res = await session.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "ix_status", arguments: {} },
    }));
    expect(res.error).toBeUndefined();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("backend not reachable");
    await session.close();
  });

  it("reports timeouts as isError results", async () => {
    const executor = new StubExecutor();
    executor.failWith = { ok: false, stdout: "", stderr: "", code: null, timedOut: true };
    const session = makeSession(executor);
    const res = await session.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "ix_rank", arguments: {} },
    }));
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("timed out");
    await session.close();
  });

  it("cancels an in-flight call on notifications/cancelled", async () => {
    const executor = new StubExecutor();
    executor.waitForAbort = true;
    const session = makeSession(executor);
    const n = session.responses.length;
    // Write the call without waiting (its response only arrives after cancel).
    session.input.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "ix_map", arguments: {} },
    }) + "\n");
    await delay(30); // let the call start and register pending
    await session.sendNoResponse(JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 11 },
    }));
    await waitUntil(() => session.responses.length > n);
    const res = session.responses[session.responses.length - 1] as any;
    expect(res.id).toBe(11);
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("cancelled");
    await session.close();
  });
});

describe("mcp server — protocol errors and lifecycle", () => {
  it("answers unknown methods with -32601", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send(JSON.stringify({ jsonrpc: "2.0", id: 12, method: "bogus/method" }));
    expect(res.error.code).toBe(-32601);
    await session.close();
  });

  it("answers malformed JSON with -32700", async () => {
    const session = makeSession(new StubExecutor());
    const res = await session.send("{not json");
    expect(res.error.code).toBe(-32700);
    await session.close();
  });

  it("ignores notifications without responding", async () => {
    const session = makeSession(new StubExecutor());
    const n = session.responses.length;
    await session.sendNoResponse(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(session.responses.length).toBe(n);
    await session.close();
  });

  it("shuts down cleanly on EOF with no further output", async () => {
    const session = makeSession(new StubExecutor());
    const n = session.responses.length;
    await session.close();
    expect(session.responses.length).toBe(n);
  });
});
