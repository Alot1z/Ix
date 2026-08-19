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

  it("never advises --resume --out to retry a combination it also rejects", () => {
    // The hint used to be "use --format json with --out", which fires this same
    // branch: the user did as they were told and got the identical error, this
    // time with no advice at all. Whatever the message suggests must be
    // something that is not itself refused here.
    for (const format of ["text", "json", "llm"]) {
      const msg = detectContextModeConflict({ resume: "x", out: "/tmp/x.json", format })!;
      expect(msg).toMatch(/--resume cannot be combined with --out/);
      expect(msg).not.toMatch(/--format json with --out/);
      // And the way out it does name has to work.
      expect(msg).toMatch(/>/);
      expect(detectContextModeConflict({ resume: "x", format: "json" })).toBeUndefined();
    }
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

  it("flags --list + --resume, which its own guard could never reach", () => {
    // `--list`'s guard named `--resume`, but it sat below `if (opts.resume)`,
    // which returns first. `ix context --list --resume widget` rendered one
    // investigation, exited 0, and never said the listing had been dropped.
    // Checked before any mode branch, that race cannot happen.
    expect(detectContextModeConflict({ list: true, resume: "x" })).toMatch(
      /--list and --resume cannot be combined/,
    );
  });

  it("flags --list + --out, which nothing checked at all", () => {
    // `ix context --list --out /tmp/list.json` listed to stdout, wrote no file,
    // and exited 0 — the silent-ignore gap this detector exists to close, on
    // the newest flag on the command it guards.
    expect(detectContextModeConflict({ list: true, out: "/tmp/list.json" })).toMatch(
      /--list cannot be combined with --out/,
    );
  });

  it("flags a positional target alongside --list", () => {
    // A positional is as ignorable as a flag: `ix context Widget --list`
    // dropped the target with nothing said.
    expect(detectContextModeConflict({ list: true }, "Widget")).toMatch(/--list takes no target/);
    // …and a target without --list is the ordinary path.
    expect(detectContextModeConflict({}, "Widget")).toBeUndefined();
    expect(detectContextModeConflict({ list: true })).toBeUndefined();
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

  it("names --summary, not --full, when all three are passed", () => {
    // Only the two-flag pairs were covered, and the three-flag case took the
    // `--full && --limit` branch: the user was told to drop one of two flags
    // that `--summary` was going to ignore anyway, while the message naming the
    // flag actually in charge was unreachable for this input.
    const msg = detectDiffModeConflict({ summary: true, full: true, limit: "20" });
    expect(msg).toMatch(/--summary ignores --limit and --full/);
    expect(msg).not.toMatch(/--full and --limit cannot be combined/);
  });
});

/**
 * The gap the detectors are for is a flag the user typed doing nothing. A flag
 * added later with no rule written for it reopens exactly that gap, silently:
 * `ContextModeOptions` was a hand-copied five-field shape, `--list` was added
 * to `ContextOptions` on a sibling branch, and neither the typechecker nor any
 * test noticed the detector could not see it.
 *
 * So one side of this comes from the live Commander registration and the other
 * is hand-listed. Two hand-lists can be wrong together; a list checked against
 * the command cannot be. Adding an option to `ix context` fails here until it
 * is classified — a mode flag with a rule, or a build knob.
 */
describe("mode-flag coverage does not drift from the command", () => {
  /** Flags that select what the command does, or where its output goes. */
  const CONTEXT_MODE_FLAGS = ["out", "save", "resume", "diff", "list"] as const;
  /** Flags that shape the bundle a mode produces; any pair of these is legal. */
  const CONTEXT_BUILD_FLAGS = [
    "kind", "path", "pick", "depth", "asOfRev",
    "maxEntities", "maxRelationships", "maxEvidence", "maxChars", "format",
  ];

  function registeredAttributes(register: (p: Command) => void, name: string): string[] {
    const program = new Command();
    program.name("ix").exitOverride();
    register(program);
    const cmd = program.commands.find((c) => c.name() === name)!;
    return cmd.options.map((o) => o.attributeName()).sort();
  }

  it("classifies every option ix context registers", () => {
    expect(registeredAttributes(registerContextCommand, "context")).toEqual(
      [...CONTEXT_MODE_FLAGS, ...CONTEXT_BUILD_FLAGS].sort(),
    );
  });

  it("refuses every pair of mode flags", () => {
    for (const a of CONTEXT_MODE_FLAGS) {
      for (const b of CONTEXT_MODE_FLAGS) {
        if (a >= b) continue;
        const opts = { [a]: "x", [b]: "y" } as Record<string, string>;
        expect(
          detectContextModeConflict(opts),
          `no rule for --${a} + --${b}`,
        ).toBeTruthy();
      }
    }
  });

  it("leaves every single mode flag alone", () => {
    // The mirror of the above: a rule that fires on one flag would refuse the
    // command's ordinary use, and a pair-only assertion cannot see that.
    for (const flag of CONTEXT_MODE_FLAGS) {
      expect(detectContextModeConflict({ [flag]: "x" })).toBeUndefined();
    }
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
  // Both, and console.log is the one that matters: under vitest `console` is
  // replaced wholesale, so it never reaches `process.stdout.write` and a
  // capture that patches only the stream sees nothing — which makes
  // `expect(stdout).toBe("")` pass no matter what the command printed.
  const origLog = console.log;
  process.stdout.write = ((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  console.log = (...a: unknown[]) => void stdout.push(a.join(" ") + "\n");
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
    console.log = origLog;
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
    { args: ["context", "--list", "--resume", "x"], expect: /--list and --resume cannot be combined/ },
    { args: ["context", "--list", "--diff", "x"], expect: /--list and --diff cannot be combined/ },
    { args: ["context", "--list", "--save", "y"], expect: /--list cannot be combined with --save/ },
    { args: ["context", "--list", "--out", "/tmp/x.json"], expect: /--list cannot be combined with --out/ },
    { args: ["context", "Widget", "--list"], expect: /--list takes no target/ },
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

describe("a caller that asked for records gets the error as a record", () => {
  // An agent is told to pass `--format llm` unconditionally, so an error it
  // cannot read is an error it cannot act on. Same shape the rest of the CLI
  // emits (imports/trace/smells/locate/callers) and the one docs/llm-format.md
  // specifies: on stdout, in-stream, exit code still non-zero.
  it("emits an error record for ix context and keeps the exit code", () => {
    const r = runProgram(registerContextCommand, [
      "context",
      "--resume",
      "x",
      "--diff",
      "y",
      "--format",
      "llm",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/^error code=mode_conflict message="/);
    // One record, on one line, with the message quoted rather than bare.
    expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(r.stderr).toBe("");
  });

  it("emits an error record for ix diff and keeps the exit code", () => {
    const r = runProgram(registerDiffCommand, [
      "diff",
      "3",
      "5",
      "--summary",
      "--content",
      "--format",
      "llm",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toMatch(/^error code=mode_conflict message="/);
    expect(r.stderr).toBe("");
  });

  it("still writes prose to stderr for every other format", () => {
    for (const format of ["text", "json"]) {
      const r = runProgram(registerContextCommand, ["context", "--resume", "x", "--diff", "y", "--format", format]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/^Error:/m);
      expect(r.stdout).toBe("");
    }
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
