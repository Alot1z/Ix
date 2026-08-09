import { describe, expect, it } from "vitest";

import { runningInstanceLines } from "../commands/view.js";

// `ix view -p <other-port>` against an already-running server exited 0 and
// printed the port it had just been *asked* for, which refuses connections,
// while the real server kept serving on the port it was launched with. The PID
// and scope were both persisted; the port was not, so this branch had nothing
// to report and echoed the request back as though it were an answer.
describe("runningInstanceLines", () => {
  it("reports where the server actually is, not what was asked for", () => {
    const lines = runningInstanceLines(19123, 19124, true);
    expect(lines[0]).toBe("  http://localhost:19123");
    // The requested port must never appear as a URL — that is the whole bug.
    expect(lines.some((l) => l.includes("http://localhost:19124"))).toBe(false);
  });

  it("explains the mismatch instead of silently ignoring the flag", () => {
    // Silently printing the right URL would fix the broken link but leave the
    // user believing -p had moved the server, which is the other half of the
    // report: the command "exits successfully".
    const lines = runningInstanceLines(19123, 19124, true);
    expect(lines.join("\n")).toContain("You asked for port 19124");
    expect(lines.join("\n")).toContain("ix view stop");
  });

  it("stays quiet when the running port is the one that was asked for", () => {
    expect(runningInstanceLines(8080, 8080, true)).toEqual(["  http://localhost:8080"]);
  });

  it("stays quiet when no port was asked for", () => {
    // The default is 8080, so a plain `ix view` against a server on 19123 must
    // not nag: the user expressed no preference. This is why the caller passes
    // getOptionValueSource rather than comparing against the default — someone
    // who explicitly types `-p 8080` gets the warning, and someone who types
    // nothing does not, even though opts().port reads 8080 in both cases.
    expect(runningInstanceLines(19123, 8080, false)).toEqual(["  http://localhost:19123"]);
  });

  it("admits it does not know rather than guessing, for a pre-existing instance", () => {
    // An instance started before the port file existed is still running and
    // still serving. Printing any URL here would be a guess, and a confidently
    // wrong URL is exactly what this fix removes.
    const lines = runningInstanceLines(null, 8080, false);
    expect(lines.join("\n")).toContain("not recorded");
    expect(lines.some((l) => l.includes("http://localhost"))).toBe(false);
  });
});
