/**
 * JSON-RPC 2.0 and Model Context Protocol constants, framing, and metadata
 * helpers for the `ix mcp` server.
 *
 * Protocol target: MCP 2026-07-28 (modern, stateless, per-request `_meta`),
 * with a legacy initialize handshake for clients speaking 2025-06-18 and
 * earlier. This mirrors the spec's "dual-era" recommendation so the same
 * stdio process serves both modern clients (Claude Code, Cursor, OpenCode,
 * MCP Inspector in modern mode) and legacy handshake clients.
 *
 * Pinned references (2026-08-11):
 *   - https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
 *   - https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 *   - https://modelcontextprotocol.io/specification/2026-07-28/server/tools
 *
 * stdio framing: UTF-8, newline-delimited JSON-RPC 2.0 messages. One message
 * per line, no embedded newlines. The server writes only protocol messages to
 * stdout; diagnostics go to stderr.
 */

export const JSONRPC_VERSION = "2.0";

/** Protocol revisions this server speaks. Modern first (preferred). */
export const MCP_SUPPORTED_VERSIONS = ["2026-07-28", "2025-06-18"] as const;

/** Version selected for modern (per-request `_meta`) requests. */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/** Version advertised to legacy initialize clients. */
export const MCP_LEGACY_VERSION = "2025-06-18";

/** Per-request metadata keys (io.modelcontextprotocol/* namespace). */
export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
export const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/** JSON-RPC error codes. */
export const ErrorCode = {
  /** Invalid JSON was received by the server. */
  ParseError: -32700,
  /** The JSON sent is not a valid Request object. */
  InvalidRequest: -32600,
  /** The method does not exist / is not available. */
  MethodNotFound: -32601,
  /** Invalid method parameter(s). */
  InvalidParams: -32602,
  /** Internal JSON-RPC error. */
  InternalError: -32603,
  /** Modern MCP: the requested protocol revision is not supported. */
  UnsupportedProtocolVersion: -32022,
} as const;

export type JsonRpcId = number | string | null;

export interface JsonRpcRequest {
  jsonrpc: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/** True for anything that carries a JSON-RPC `method` field. */
export function isJsonRpcMessage(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as JsonRpcRequest).method === "string"
  );
}

/** A request is a response-bearing call when it has an `id`. */
export function hasId(value: JsonRpcRequest): value is JsonRpcRequest & { id: Exclude<JsonRpcId, undefined> } {
  return value.id !== undefined;
}

/**
 * Read the protocol version a modern client declared in `_meta`. Returns
 * undefined when the request carries no per-request metadata (a legacy-era
 * client, which must use the initialize handshake instead).
 */
export function metaProtocolVersion(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const meta = (params as { _meta?: unknown })._meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  const version = (meta as Record<string, unknown>)[META_PROTOCOL_VERSION];
  return typeof version === "string" ? version : undefined;
}

/** Extract the server-info object this process should advertise. */
export interface McpServerInfo {
  name: string;
  version: string;
}

/**
 * Parse one line of stdio framing. A blank line carries no message; anything
 * else is parsed as JSON (the caller turns a parse failure into a JSON-RPC
 * ParseError response).
 */
export function parseLine(line: string): unknown {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  return JSON.parse(trimmed) as unknown;
}

/**
 * Serialize a message to a single newline-delimited line. JSON.stringify
 * never emits raw newlines inside strings, so one message always maps to one
 * line — the stdio framing contract.
 */
export function serializeMessage(message: unknown): string {
  return JSON.stringify(message);
}
