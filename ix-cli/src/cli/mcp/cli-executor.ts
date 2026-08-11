/**
 * The production tool executor: runs each tool as a child `ix` process.
 *
 * This is the same discipline as the view server's `/__ix/remap` handler
 * (F-010): spawn `node <cli-main> <command> ...` with execFile-style argv
 * (no shell, fixed executable, validated arguments), a hard wall-clock
 * timeout, and a kill on client cancellation. The tool's own arguments can
 * never be interpreted by a shell because there is no shell.
 */

import { spawn } from "node:child_process";
import { buildArgv } from "./tools.js";
import type { ToolDefinition, ToolArgs, ToolExecutor, ToolRunOptions, ToolRunResult } from "./types.js";

const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

export interface CliToolExecutorOptions {
  /**
   * Path to the CLI entry (main.js). Defaults to the process that launched
   * the MCP server (argv[1]), which is correct both for `ix mcp` from the
   * installed CLI and for the dev entry. Tests override via
   * IX_MCP_CLI_MAIN to point at a deterministic fixture.
   */
  cliMain?: string;
  /** Cap on captured stdout/stderr; the child is killed if it exceeds this. */
  maxBufferBytes?: number;
}

export class CliToolExecutor implements ToolExecutor {
  readonly cliMain: string;
  readonly maxBufferBytes: number;

  constructor(options: CliToolExecutorOptions = {}) {
    this.cliMain = options.cliMain ?? process.env.IX_MCP_CLI_MAIN ?? process.argv[1] ?? "ix";
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  }

  async run(
    tool: ToolDefinition,
    args: ToolArgs,
    options: ToolRunOptions,
  ): Promise<ToolRunResult> {
    const argv = [this.cliMain, ...buildArgv(tool, args)];
    return spawnNode(argv, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      maxBufferBytes: this.maxBufferBytes,
    });
  }
}

interface SpawnOptions {
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxBufferBytes: number;
}

function spawnNode(argv: string[], options: SpawnOptions): Promise<ToolRunResult> {
  return new Promise<ToolRunResult>((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, argv, {
        cwd: options.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        ok: false,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        code: null,
        timedOut: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutOverflow = false;
    let settled = false;
    let timedOut = false;
    let cancelled = false;

    const settle = (result: ToolRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => {
      cancelled = true;
      try {
        child.kill();
      } catch {
        // already exited
      }
    };
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // already exited
      }
    }, options.timeoutMs);
    // Unref the timer so a hung child can't hold the server open beyond its
    // own timeout path.
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > options.maxBufferBytes) {
        stdoutOverflow = true;
        try {
          child.kill();
        } catch {
          // already exited
        }
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length + chunk.length > options.maxBufferBytes) {
        // Kill on stderr overflow too: a stuck command can otherwise pin the
        // server's memory forever. The truncated stderr is reported below.
        try {
          child.kill();
        } catch {
          // already exited
        }
        return;
      }
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: Error) => {
      settle({
        ok: false,
        stdout,
        stderr: stderr || err.message,
        code: null,
        timedOut,
        cancelled,
      });
    });

    child.on("close", (code: number | null) => {
      if (timedOut) {
        settle({
          ok: false,
          stdout,
          stderr: stderr || `timed out after ${options.timeoutMs}ms`,
          code,
          timedOut: true,
          cancelled,
        });
        return;
      }
      if (cancelled) {
        settle({ ok: false, stdout, stderr: stderr || "cancelled", code, timedOut: false, cancelled: true });
        return;
      }
      if (stdoutOverflow) {
        settle({
          ok: false,
          stdout,
          stderr: stderr || `output exceeded ${options.maxBufferBytes} bytes`,
          code,
          timedOut: false,
          cancelled,
        });
        return;
      }
      settle({ ok: code === 0, stdout, stderr, code, timedOut: false, cancelled });
    });
  });
}
