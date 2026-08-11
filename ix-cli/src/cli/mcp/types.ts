/**
 * Shared types for the `ix mcp` implementation.
 */

/** Tool arguments as supplied by the MCP client (validated against the schema). */
export type ToolArgs = Record<string, unknown>;

/** A flag on the underlying CLI command. */
export interface ToolFlag {
  /** Key in the tool's input schema. */
  property: string;
  /** Exact CLI flag, e.g. "--min-confidence". */
  flag: string;
  /** Argument kind: boolean flags take no value. */
  kind: "string" | "number" | "boolean";
}

/** A positional argument on the underlying CLI command. */
export interface ToolPositional {
  /** Key in the tool's input schema. */
  property: string;
  required: boolean;
  /** CLI argument name (diagnostic only). */
  flag: string;
}

export interface SchemaProperty {
  type: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  description?: string;
}

export interface ToolInputSchema {
  type: "object";
  additionalProperties: false;
  properties: Record<string, SchemaProperty>;
  required?: string[];
}

/** A single MCP tool definition, bound to one `ix` CLI command. */
export interface ToolDefinition {
  /** MCP tool name (unique, [A-Za-z0-9_-]). */
  name: string;
  /** Human/LLM-facing description of what the tool does. */
  description: string;
  /** The `ix` subcommand this tool invokes. */
  command: string;
  /** Optional positional argument passed verbatim to the CLI. */
  positional?: ToolPositional;
  /** Whitelisted flags mapped from schema keys. */
  flags: ToolFlag[];
  /** JSON Schema for the tool's arguments. */
  inputSchema: ToolInputSchema;
}

/** Outcome of one tool execution. */
export interface ToolRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  /** Set when the call was cancelled (notifications/cancelled). */
  cancelled?: boolean;
}

/** Execution options passed with every tool call. */
export interface ToolRunOptions {
  /** Working directory for the spawned CLI. */
  cwd?: string;
  /** Wall-clock budget; the child is killed on expiry. */
  timeoutMs: number;
  /** Abort the child when the client cancels the request. */
  signal?: AbortSignal;
}

/** The seam the server uses to run tools; tests inject a stub here. */
export interface ToolExecutor {
  run(tool: ToolDefinition, args: ToolArgs, options: ToolRunOptions): Promise<ToolRunResult>;
}

/** Injectable stdio streams (defaults to process.stdin/stdout). */
export interface McpIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}
