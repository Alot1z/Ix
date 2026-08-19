import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Command } from "commander";

import {
  detectContextModeConflict,
  registerContextCommand,
} from "../commands/context.js";
import {
  detectDiffModeConflict,
  registerDiffCommand,
} from "../commands/diff.js";

/**
 * C-1..C-4 silent-ignore flag gaps in `ix context` and C-5 in `ix diff` are now
 * surfaced as hard errors at the top of the action handler. These tests pin
 * both the pure functions and the integration through the real Commander
 * registration. The detectors run before any network call, so the action
 * returns before touching the real Ix backend; no mocks are needed for the
 * conflict paths.
 */

let home: string;
let origExitCode: number | string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ix-mode-conflict-test-"));
  process.env.IX_HOME = home;
  origExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  delete process.env.IX_HOME;
  rmSync(home, { recursive: true, force: true });
  process.exitCode = origExitCode;
});

describe("detectContextModeConflict", () => {
  it("returns undefined when no flags are set", () => {
    expect(detectContextModeConflict({})).toBeUndefined();
  });

  it("returns undefined for a single mode flag with neutral extras", () => {
    expect(detectContextModeConflict({ resume: "x" })).toBeUndefined();
    expect(detectContextModeConflict({ diff: "x" })).toBeUndefined();
    expect(detectContextModeConflict({ save: "y" })).toBeUndefined();
    expect(detectContextModeConflict({ out: "/tmp/x.json" })).toBeUndefined();
  });

  it("returns undefined for the legal save+resolve target run", () => {
    // Fresh build with --save is fine; this is the contract path.
    expect(detectContextModeConflict({ save: "y", format: "text" })).toBeUndefined();
    // Fresh build with --out is fine in json mode (the existing renderWarning
    // path still applies; the conflict detector does not flag it).
    expect(detectContextModeConflict({ out: "/tmp/x.json", format: "json" })).toBeUndefined();
  });

  it("flags --resume + --diff", () => {
    const msg = detectContextModeConflict({ resume: "x", diff: "y" });
    expect(msg).toMatch(/--resume and --diff cannot be combined/);
  });

  it("flags --resume + --save", () => {
    const msg = detectContextModeConflict({ resume: "x", save: "y" });
    expect(msg).toMatch(/--resume cannot be combined with --save/);
  });

  it("flags --resume + --out (C-3 right-hand case)", () => {
    const msg = detectContextModeConflict({ resume: "x", out: "/tmp/x.json" });
    expect(msg).toMatch(/--resume cannot be combined with --out/);
  });

  it("suggests --format json to --resume --out when format is non-json", () => {
    const msg = detectContextModeConflict({
      resume: "x",
      out: "/tmp/x.json",
      format: "llm",
    });
    expect(msg).toMatch(/--resume cannot be combined with --out/);
    expect(msg).toMatch(/--format json with --out/);
  });

  it("flags --diff + --save (C-1)", () => {
    const msg = detectContextModeConflict({ diff: "x", save: "y" });
    expect(msg).toMatch(/--diff cannot be combined with --save/);
  });

  it("flags --diff + --out (C-3 left-hand case)", () => {
    const msg = detectContextModeConflict({ diff: "x", out: "/tmp/x.json" });
    expect(msg).toMatch(/--diff cannot be combined with --out/);
  });

  it("flags --save + --out (C-4): two different write targets", () => {
    const msg = detectContextModeConflict({ save: "y", out: "/tmp/x.json" });
    expect(msg).toMatch(/--save and --out cannot be combined/);
  });

  it("flags --resume alongside every other write flag", () => {
    // The three write flags the resume branch returns before.
    for (const other of [{ diff: "y" }, { save: "y" }, { out: "/tmp/x.json" }]) {
      expect(detectContextModeConflict({ resume: "x", ...other })).toMatch(/--resume/);
    }
  });
});

describe("detectDiffModeConflict", () => {
  it("returns undefined when no flags are set", () => {
    expect(detectDiffModeConflict({})).toBeUndefined();
  });

  it("returns undefined for legal single flags", () => {
    expect(detectDiffModeConflict({ summary: true })).toBeUndefined();
    expect(detectDiffModeConflict({ content: true })).toBeUndefined();
    expect(detectDiffModeConflict({ full: true })).toBeUndefined();
    expect(detectDiffModeConflict({ limit: "20" })).toBeUndefined();
  });

  it("flags --summary + --content (C-5)", () => {
    const msg = detectDiffModeConflict({ summary: true, content: true });
    expect(msg).toMatch(/--summary and --content cannot be combined/);
  });

  it("flags --full + --limit", () => {
    const msg = detectDiffModeConflict({ full: true, limit: "20" });
    expect(msg).toMatch(/--full and --limit cannot be combined/);
  });

  it("does NOT flag --full without --limit (--full alone is the documented path)", () => {
    expect(detectDiffModeConflict({ full: true })).toBeUndefined();
  });

  it("does NOT flag --limit alone (default behaviour)", () => {
    expect(detectDiffModeConflict({ limit: "20" })).toBeUndefined();
  });

  it("flags --summary alongside --limit or --full", () => {
    const a = detectDiffModeConflict({ summary: true, limit: "20" });
    expect(a).toMatch(/--summary ignores --limit and --full/);
    const b = detectDiffModeConflict({ summary: true, full: true });
    expect(b).toMatch(/--summary ignores --limit and --full/);
  });
});

/**
 * Drive the real `registerX` functions through Commander so we verify that:
 *
 *   1. the detector runs FIRST in the action handler (no network call);
 *   2. the surfaced message lands on stderr with an "Error:" prefix;
 *   3. process.exitCode is set to 1;
 *   4. resolution/fresh-build code paths do NOT touch stdout.
 *
 * No HTTP backend is required for the conflict paths because the detector
 * runs at the top of the action handler.
 */
function runProgram(
  register: (program: Command) => void,
  args: string[],
): { stderr: string; exitCode: number | string | undefined; stdout: string } {
  const program = new Command();
  program.name("ix").exitOverride();
  register(program);

  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origErr = console.error;
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  console.error = (...a: unknown[]) => void stderr.push(a.join(" "));

  let code: number | string | undefined;
  try {
    program.parse(["node", "ix", ...args]);
  } catch (e) {
    // exitOverride turns process.exit into a CommanderError; we still want
    // the (possibly already-set) exitCode. The error message ends up in
    // stderr elsewhere; do not forward here.
    void e;
  } finally {
    code = process.exitCode;
    process.stdout.write = origStdout;
    console.error = origErr;
  }
  return { stderr: stderr.join("\n"), stdout: stdout.join(""), exitCode: code };
}

describe("ix context action surfaces mode conflicts on stderr and exits 1", () => {
  it.each([
    { args: ["context", "--resume", "x", "--diff", "y"], expect: /--resume and --diff/ },
    { args: ["context", "--resume", "x", "--save", "y"], expect: /--resume cannot be combined with --save/ },
    { args: ["context", "--resume", "x", "--out", "/tmp/x.json"], expect: /--resume cannot be combined with --out/ },
    { args: ["context", "--diff", "x", "--save", "y"], expect: /--diff cannot be combined with --save/ },
    { args: ["context", "--diff", "x", "--out", "/tmp/x.json"], expect: /--diff cannot be combined with --out/ },
    { args: ["context", "--save", "y", "--out", "/tmp/x.json"], expect: /--save and --out cannot be combined/ },
  ])("ix $args → stderr matches $expect and exit code is 1", ({ args, expect: re }) => {
    const r = runProgram(registerContextCommand, args);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/^Error:/m);
    expect(r.stderr).toMatch(re);
    expect(r.stdout).toBe("");
  });
});

describe("ix diff action surfaces mode conflicts on stderr and exits 1", () => {
  it.each([
    { args: ["diff", "3", "5", "--summary", "--content"], expect: /--summary and --content cannot be combined/ },
    { args: ["diff", "3", "5", "--full", "--limit", "20"], expect: /--full and --limit cannot be combined/ },
    { args: ["diff", "3", "5", "--summary", "--limit", "20"], expect: /--summary ignores --limit and --full/ },
    { args: ["diff", "3", "5", "--summary", "--full"], expect: /--summary ignores --limit and --full/ },
  ])("ix diff $args → stderr matches $expect and exit code is 1", ({ args, expect: re }) => {
    const r = runProgram(registerDiffCommand, args);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/^Error:/m);
    expect(r.stderr).toMatch(re);
    expect(r.stdout).toBe("");
  });
});

describe("ix help coverage stays intact (smoke)", () => {
  it("context help still lists --resume, --diff, --save, --out", () => {
    const program = new Command();
    program.name("ix").exitOverride();
    registerContextCommand(program);
    const help = program.commands.find((c) => c.name() === "context")!.helpInformation();
    expect(help).toMatch(/--save <id>/);
    expect(help).toMatch(/--resume <id>/);
    expect(help).toMatch(/--diff <id>/);
    expect(help).toMatch(/--out <path>/);
  });

  it("diff help still lists --summary, --content, --full, --limit", () => {
    const program = new Command();
    program.name("ix").exitOverride();
    registerDiffCommand(program);
    const help = program.commands.find((c) => c.name() === "diff")!.helpInformation();
    expect(help).toMatch(/--summary/);
    expect(help).toMatch(/--content/);
    expect(help).toMatch(/--full/);
    expect(help).toMatch(/--limit/);
  });
});
