/**
 * The production tool executor: runs each tool as a child `ix` process.
 *
 * This is the same discipline as the view server's `/__ix/remap` handler
 * (F-010): spawn `node <cli-main> <command> ...` with execFile-style argv
 * (no shell, fixed executable, validated arguments), a hard wall-clock
 * timeout, and a kill on client cancellation. The tool's own arguments can
 * never be interpreted by a shell because there is no shell.
 *
 * Orphan discipline: each child is spawned detached so it leads its own
 * process group (POSIX). On cancel / timeout / output overflow / shutdown the
 * whole tree is killed — the group on POSIX, `taskkill /T` on Windows — so a
 * tool that itself spawned a backend process (the indexing service) cannot
 * leak it after the call is aborted.
 */

import { spawn, type ChildProcess } from "node:child_process";
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
  /** Every live child (tree root); disposeAll() kills them on shutdown. */
  private readonly active = new Set<ChildProcess>();

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
      active: this.active,
    });
  }

  /** Kill every in-flight child tree. Used on shutdown (EOF or signal). */
  disposeAll(): void {
    for (const child of this.active) killProcessTree(child);
    this.active.clear();
  }
}

interface SpawnOptions {
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxBufferBytes: number;
  active: Set<ChildProcess>;
}

function spawnNode(argv: string[], options: SpawnOptions): Promise<ToolRunResult> {
  return new Promise<ToolRunResult>((resolve) => {
    let child: ChildProcess | undefined;
    try {
      child = spawn(process.execPath, argv, {
        cwd: options.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // Own process group (POSIX) so killProcessTree can signal the whole
        // tree. On Windows taskkill /T covers the tree instead.
        detached: process.platform !== "win32",
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
    if (!child || child.stdout === null || child.stderr === null) {
      if (child) killProcessTree(child);
      resolve({ ok: false, stdout: "", stderr: "failed to spawn child", code: null, timedOut: false });
      return;
    }
    const outStream = child.stdout;
    const errStream = child.stderr;
    options.active.add(child);

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
      options.active.delete(child);
      resolve(result);
    };

    const onAbort = () => {
      cancelled = true;
      killProcessTree(child);
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
      killProcessTree(child);
    }, options.timeoutMs);
    // Unref the timer so a hung child can't hold the server open beyond its
    // own timeout path.
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }

    outStream.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > options.maxBufferBytes) {
        stdoutOverflow = true;
        killProcessTree(child);
        return;
      }
      stdout += chunk.toString("utf8");
    });
    errStream.on("data", (chunk: Buffer) => {
      if (stderr.length + chunk.length > options.maxBufferBytes) {
        // Kill on stderr overflow too: a stuck command can otherwise pin the
        // server's memory forever. The truncated stderr is reported below.
        killProcessTree(child);
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

/**
 * Kill a child and everything it spawned. Children are spawned detached, so
 * on POSIX the group signal reaches grandchildren; on Windows taskkill /T
 * walks the parent/child tree.
 */
function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.unref();
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }
    return;
  }
  // POSIX: the child leads its own process group (spawned detached), so a
  // group signal reaches grandchildren too.
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already exited
    }
  }
  // Escalate to SIGKILL for the group if the graceful signal didn't land.
  const timer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // group gone
    }
  }, 2000);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
}
