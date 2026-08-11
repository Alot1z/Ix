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

import { ErrorCode, hasId, isJsonRpcMessage, JSONRPC_VERSION, MCP_LEGACY_VERSION, MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS, META_PROTOCOL_VERSION, META_SERVER_INFO, metaProtocolVersion, parseLine, serializeMessage } from "./protocol.js";
import { findTool, validateArgs, toolTimeoutMs } from "./tools.js";
import type { McpIo, ToolDefinition, ToolExecutor, ToolRunResult } from "./types.js";
import type { JsonRpcId } from "./protocol.js";

export interface McpServerOptions {
  tools?: ToolDefinition[];
  executor: ToolExecutor;
  io?: McpIo;
  /** Advertised server identity; defaults to ix + the CLI package version. */
  serverInfo?: { name: string; version: string };
  /**
   * Byte cap on one stdio message line. A line above this is rejected with a
   * ParseError and the reader resyncs at the next newline — a pathological
   * client can never make the server buffer more than this per message.
   */
  maxLineBytes?: number;
}

/** Default cap on one stdio message line (newline-delimited framing). */
const DEFAULT_MAX_LINE_BYTES = 1 * 1024 * 1024; // 1 MiB

/**
 * Byte-bounded streaming line splitter for the stdio transport.
 *
 * Unlike readline, which buffers a whole line before emitting it, this reader
 * tracks the byte length of the in-flight line and never accumulates more than
 * `maxBytes` for a single line. If a line grows past the cap it is reported
 * via `onOversize` and its tail is then discarded: the reader resyncs at the
 * next newline, so the session stays usable. This closes the memory- and
 * CPU-exhaustion vector of a client sending unbounded lines.
 */
class LineReader {
  private pending = "";
  private pendingBytes = 0;
  /** True while the tail of an oversized line is being discarded. */
  private discarding = false;

  constructor(
    private readonly maxBytes: number,
    private readonly onLine: (line: string) => void,
    private readonly onOversize: (bytes: number) => void,
  ) {}

  push(chunk: string | Buffer): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) !== 10) continue; // \n
      const segment = text.slice(start, i);
      start = i + 1;
      if (this.discarding) {
        // End of the oversized line: drop the tail, resume normal parsing.
        this.discarding = false;
        this.pending = "";
        this.pendingBytes = 0;
        continue;
      }
      const line = this.pending + segment;
      const bytes = this.pendingBytes + Buffer.byteLength(segment, "utf8");
      this.pending = "";
      this.pendingBytes = 0;
      if (bytes > this.maxBytes) {
        this.onOversize(bytes);
        continue;
      }
      this.onLine(stripLineBreak(line));
    }
    if (start < text.length) {
      const rest = text.slice(start);
      if (this.discarding) return; // still inside the oversized line
      this.pendingBytes += Buffer.byteLength(rest, "utf8");
      if (this.pendingBytes > this.maxBytes) {
        const exceeded = this.pendingBytes;
        this.discarding = true;
        this.pending = "";
        this.pendingBytes = 0;
        this.onOversize(exceeded);
      } else {
        this.pending += rest;
      }
    }
  }
}

/** Strip a trailing CR from CRLF line endings (framing tolerates CRLF). */
function stripLineBreak(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
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
  private readonly maxLineBytes: number;

  /** Request id → AbortController for in-flight tool calls (cancellation). */
  private readonly pending = new Map<JsonRpcId, AbortController>();

  /** Serializes message handling so tool calls never overlap. */
  private queue: Promise<void> = Promise.resolve();

  /** Set once stdin closes; responses after this are dropped (client gone). */
  private closed = false;

  constructor(options: McpServerOptions) {
    this.tools = options.tools ?? [];
    this.executor = options.executor;
    this.serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;
    this.io = options.io ?? { input: process.stdin, output: process.stdout };
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  }

  /**
   * Serve until stdin closes (EOF = clean shutdown) or the stream errors.
   * Resolves when the server has finished and written everything out.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const input = this.io.input as NodeJS.ReadableStream;
      const reader = new LineReader(
        this.maxLineBytes,
        (line) => this.dispatchLine(line),
        (bytes) => {
          // Oversized message: reply with a ParseError and resync at the next
          // newline. Memory stays bounded because the reader never buffers
          // more than maxLineBytes for a single line.
          this.writeMessage({
            jsonrpc: "2.0",
            id: null,
            error: { code: ErrorCode.ParseError, message: `Message too large (${bytes} bytes; limit ${this.maxLineBytes})` },
          });
        },
      );
      input.on("data", (chunk: Buffer) => reader.push(chunk));
      input.on("end", () => {
        // Client disconnected (EOF): cancel in-flight tool calls and shut down
        // promptly instead of waiting for a slow map to drain. Same discipline
        // as the view server's remap handler, which kills the child when the
        // client goes away. Responses after this point are dropped — the pipe
        // is gone, and writing would raise EPIPE.
        this.closed = true;
        for (const controller of this.pending.values()) controller.abort();
        this.pending.clear();
        void this.flushOutput().then(() => resolve());
      });
      input.on("error", reject);
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
    if (Array.isArray(message)) {
      // JSON-RPC batches are rejected wholesale: the spec permits a single
      // Invalid Request response for a batch the server does not support.
      this.writeMessage({
        jsonrpc: "2.0",
        id: null,
        error: { code: ErrorCode.InvalidRequest, message: "Batch requests are not supported" },
      });
      return;
    }

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

    // JSON-RPC 2.0 compliance: wrong version or a non-scalar id makes the
    // whole request object invalid (respond with a null id rather than echo
    // an id that is not a valid JSON-RPC id).
    if (message.jsonrpc !== JSONRPC_VERSION) {
      this.respondError(id, ErrorCode.InvalidRequest, `Invalid Request: jsonrpc must be ${JSONRPC_VERSION}`);
      return;
    }
    if (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number" && message.id !== null) {
      this.respondError(null, ErrorCode.InvalidRequest, "Invalid Request: id must be a string, number, or null");
      return;
    }

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
          instructions: "Ix exposes its code-graph commands (map, status, explain, trace, impact, search, rank, read) as tools.",
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
    if (this.closed) return; // client disconnected — the pipe is gone
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
