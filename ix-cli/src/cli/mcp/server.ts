/**
 * The `ix mcp` server core.
 *
 * Dual-era per MCP 2026-07-28 (https://modelcontextprotocol.io/specification/2026-07-28):
 *   - Modern requests carry protocol version + client capabilities in
 *     `_meta.io.modelcontextprotocol/*` and are served statelessly. The
 *     client may probe `server/discover` first (we implement it).
 *   - Legacy clients (2025-06-18 and earlier) open with an `initialize`
 *     handshake; we answer and serve them with the same tool surface.
 *
 * Requests are processed sequentially (one in-flight tool call at a time):
 * every tool spawns a child `ix` process, so pipelining would let a slow map
 * pile up unbounded children. Sequential processing bounds resource usage and
 * keeps cancellation semantics simple. Tool calls still abort their child the
 * moment the client sends notifications/cancelled.
 *
 * The io seam (input/output streams) is injectable so tests can drive a full
 * protocol session with PassThrough streams and a stub executor.
 */

import { createInterface } from "node:readline";
import { ErrorCode, hasId, isJsonRpcMessage, MCP_LEGACY_VERSION, MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS, META_PROTOCOL_VERSION, META_SERVER_INFO, metaProtocolVersion, parseLine, serializeMessage } from "./protocol.js";
import { findTool, validateArgs, toolTimeoutMs } from "./tools.js";
import type { McpIo, ToolDefinition, ToolExecutor, ToolRunResult } from "./types.js";
import type { JsonRpcId } from "./protocol.js";

export interface McpServerOptions {
  tools?: ToolDefinition[];
  executor: ToolExecutor;
  io?: McpIo;
  /** Advertised server identity; defaults to ix + the CLI package version. */
  serverInfo?: { name: string; version: string };
}

const DEFAULT_SERVER_INFO = { name: "ix", version: "0.9.2" };

interface ToolCallParams {
  name?: unknown;
  arguments?: unknown;
}

export class McpServer {
  private readonly tools: ToolDefinition[];
  private readonly executor: ToolExecutor;
  private readonly io: McpIo;
  private readonly serverInfo: { name: string; version: string };

  /** Request id → AbortController for in-flight tool calls (cancellation). */
  private readonly pending = new Map<JsonRpcId, AbortController>();

  /** Serializes message handling so tool calls never overlap. */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: McpServerOptions) {
    this.tools = options.tools ?? [];
    this.executor = options.executor;
    this.serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;
    this.io = options.io ?? { input: process.stdin, output: process.stdout };
  }

  /**
   * Serve until stdin closes (EOF = clean shutdown) or the stream errors.
   * Resolves when the server has finished and written everything out.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const rl = createInterface({ input: this.io.input as NodeJS.ReadableStream, crlfDelay: Infinity, terminal: false });

      rl.on("line", (line) => {
        this.dispatchLine(line);
      });
      rl.on("close", () => {
        this.enqueue(async () => {
          // Flush pending writes before resolving.
          await this.flushOutput();
          resolve();
        });
      });
      rl.on("error", (err) => {
        reject(err);
      });
      this.io.input.on?.("error", reject);
    });
  }

  /** Chain a handler onto the processing queue. */
  private enqueue(handler: () => Promise<void>): void {
    this.queue = this.queue.then(handler).catch((err) => {
      // A handler must never throw into the queue and stall the loop.
      this.writeMessage({ jsonrpc: "2.0", id: null, error: { code: ErrorCode.InternalError, message: `internal error: ${err instanceof Error ? err.message : String(err)}` } });
    });
  }

  /**
   * Route an incoming line. Notifications bypass the processing queue so a
   * `notifications/cancelled` can abort an in-flight tool call — queueing it
   * behind the call it is meant to cancel would deadlock. Requests go through
   * the queue, which guarantees one in-flight tool call at a time.
   */
  private dispatchLine(line: string): void {
    let message: unknown;
    try {
      message = parseLine(line);
    } catch {
      this.writeMessage({ jsonrpc: "2.0", id: null, error: { code: ErrorCode.ParseError, message: "Parse error" } });
      return;
    }
    if (message === undefined) return; // blank line

    const isNotification = isJsonRpcMessage(message) && !hasId(message);
    if (isNotification) {
      // Fire and forget — notifications carry no response and must never be
      // blocked behind a long-running tool call.
      this.handleMessage(message).catch((err) => {
        this.writeMessage({
          jsonrpc: "2.0",
          id: null,
          error: { code: ErrorCode.InternalError, message: `internal error: ${err instanceof Error ? err.message : String(err)}` },
        });
      });
      return;
    }
    this.enqueue(() => this.handleMessage(message));
  }

  async handleMessage(message: unknown): Promise<void> {
    if (!isJsonRpcMessage(message)) {
      if (typeof message === "object" && message !== null && "id" in (message as Record<string, unknown>)) {
        this.writeMessage({ jsonrpc: "2.0", id: (message as { id?: JsonRpcId }).id ?? null, error: { code: ErrorCode.InvalidRequest, message: "Invalid Request" } });
      }
      return;
    }

    const { method, params } = message;
    // Notifications (no id) never receive a response; null is the JSON-RPC
    // fallback id and is only reachable on the early-return paths below.
    const id: JsonRpcId = message.id !== undefined ? message.id : null;
    const isNotification = !hasId(message);

    // Modern protocol version gate: a request carrying per-request metadata
    // declares its revision in _meta. Unknown revisions are rejected with the
    // spec's UnsupportedProtocolVersionError so the client can retry.
    if (!isNotification) {
      const declared = metaProtocolVersion(params);
      if (declared !== undefined && !(MCP_SUPPORTED_VERSIONS as readonly string[]).includes(declared)) {
        this.respondError(id, ErrorCode.UnsupportedProtocolVersion, "Unsupported protocol version", {
          supported: MCP_SUPPORTED_VERSIONS,
          requested: declared,
        });
        return;
      }
    }

    switch (method) {
      case "initialize": {
        // Legacy-era handshake (2025-11-25 and earlier). Modern clients never
        // send this. Respond with the negotiated legacy revision.
        if (isNotification) return;
        this.respond(id, {
          protocolVersion: MCP_LEGACY_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.serverInfo,
          instructions: "Ix exposes its code-graph commands (map, status, explain, trace, impact, search, rank) as tools.",
        });
        return;
      }
      case "server/discover": {
        // Modern-era discovery (2026-07-28+). The client may probe before any
        // other request; identity travels in response _meta per the spec.
        if (isNotification) return;
        this.respond(id, {
          resultType: "complete",
          supportedVersions: MCP_SUPPORTED_VERSIONS,
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
        });
        return;
      }
      case "ping": {
        // Legacy liveness check. Modern clients probe with server/discover;
        // answering ping is harmless and keeps legacy clients working.
        if (isNotification) return;
        this.respond(id, {});
        return;
      }
      case "notifications/initialized":
        // Legacy client acknowledges the handshake. Nothing to do.
        return;
      case "notifications/cancelled": {
        // stdio cancellation: abort the in-flight request (kills the child).
        const requestId = (params as { requestId?: JsonRpcId } | undefined)?.requestId;
        if (requestId !== undefined) {
          const controller = this.pending.get(requestId);
          if (controller) {
            controller.abort();
            this.pending.delete(requestId);
          }
        }
        return;
      }
      case "tools/list": {
        if (isNotification) return;
        this.respond(id, {
          resultType: "complete",
          tools: this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
        return;
      }
      case "tools/call": {
        if (isNotification) return;
        await this.handleToolCall(id, params);
        return;
      }
      default: {
        if (isNotification) return; // unknown notification: ignore
        this.respondError(id, ErrorCode.MethodNotFound, `Method not found: ${method}`);
      }
    }
  }

  private async handleToolCall(id: JsonRpcId, params: unknown): Promise<void> {
    const p = (params ?? {}) as ToolCallParams;
    const name = p.name;
    if (typeof name !== "string" || name.length === 0) {
      this.respondError(id, ErrorCode.InvalidParams, "tools/call requires a tool name");
      return;
    }
    const tool = findTool(name);
    if (!tool) {
      this.respondError(id, ErrorCode.InvalidParams, `Unknown tool: ${name}`);
      return;
    }

    const args = p.arguments ?? {};
    const problem = validateArgs(tool, args);
    if (problem !== null) {
      this.respondError(id, ErrorCode.InvalidParams, `Invalid arguments for ${name}: ${problem}`);
      return;
    }

    const controller = new AbortController();
    this.pending.set(id, controller);

    try {
      const timeoutMs = toolTimeoutMs(tool);
      const result: ToolRunResult = await this.executor.run(tool, args as Record<string, unknown>, {
        timeoutMs,
        signal: controller.signal,
      });

      if (result.cancelled) {
        // The client asked us to stop; report it as a failed tool result
        // rather than a protocol error.
        this.respond(id, {
          resultType: "complete",
          content: [{ type: "text", text: `ix ${tool.command}: cancelled` }],
          isError: true,
        });
        return;
      }
      if (result.timedOut) {
        this.respond(id, {
          resultType: "complete",
          content: [{ type: "text", text: `ix ${tool.command}: timed out after ${timeoutMs}ms${result.stderr ? ` — ${truncate(result.stderr, 500)}` : ""}` }],
          isError: true,
        });
        return;
      }
      if (result.ok) {
        this.respond(id, {
          resultType: "complete",
          content: [{ type: "text", text: result.stdout === "" ? "(no output)" : result.stdout }],
          isError: false,
        });
        return;
      }
      // Command failed (non-zero exit). Surface stderr, truncated.
      this.respond(id, {
        resultType: "complete",
        content: [{ type: "text", text: truncate(result.stderr || result.stdout || `ix ${tool.command} exited with code ${result.code ?? "unknown"}`, 4000) }],
        isError: true,
      });
    } finally {
      this.pending.delete(id);
    }
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.writeMessage({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    this.writeMessage({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
  }

  private writeMessage(message: unknown): void {
    // Responses carry the server identity for modern clients
    // (io.modelcontextprotocol/serverInfo in _meta). Legacy clients ignore it.
    let payload = message;
    const asRecord = message as Record<string, unknown>;
    if (asRecord && asRecord.error === undefined) {
      payload = { ...asRecord, _meta: { [META_SERVER_INFO]: this.serverInfo } };
    }
    this.io.output.write(serializeMessage(payload) + "\n");
  }

  private async flushOutput(): Promise<void> {
    const output = this.io.output as NodeJS.WritableStream & { write: (chunk: string) => boolean; writableNeedDrain?: boolean };
    if (typeof output.write === "function" && output.writableNeedDrain === true) {
      await new Promise<void>((resolve) => output.once("drain", () => resolve()));
    }
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (truncated)`;
}

export { META_PROTOCOL_VERSION };
