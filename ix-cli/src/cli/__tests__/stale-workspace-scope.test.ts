import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectStaleFiles } from "../stale.js";
import { ingestMtimeCachePath } from "../config.js";
import type { IxClient } from "../../client/api.js";

let home: string;
const saved: Record<string, string | undefined> = {};

// HOME *and* USERPROFILE: os.homedir() reads USERPROFILE on Windows and HOME on
// POSIX, so overriding only one sends the Windows run at the real profile — where
// ~/.ix may not exist and the seed write fails with ENOENT before any assertion
// runs. Setting both keeps every platform inside the temp directory.
const HOME_VARS = ["HOME", "USERPROFILE"] as const;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ix-stale-home-"));
  for (const key of HOME_VARS) {
    saved[key] = process.env[key];
    process.env[key] = home;
  }
  mkdirSync(join(home, ".ix"), { recursive: true });
});

afterEach(() => {
  for (const key of HOME_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(home, { recursive: true, force: true });
});

/** A workspace with one source file, and the ingest record that matches it. */
function seedWorkspace(name: string): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), `ix-ws-${name}-`));
  const file = join(root, `${name}.js`);
  writeFileSync(file, `export const value = "${name}";\n`);
  writeFileSync(
    ingestMtimeCachePath(root),
    JSON.stringify({ root, files: { [file]: statSync(file).mtimeMs } })
  );
  return { root, file };
}

function touch(file: string): void {
  const future = new Date(Date.now() + 10_000);
  utimesSync(file, future, future);
}

/**
 * detectStaleFiles only calls listPatches, for the graph revision. `rev` is the
 * knob the bug turned: mapping another workspace advanced it, and with it the
 * timestamp the old code compared every file against.
 */
function fakeClient(rev: number, timestamp: string): IxClient {
  return {
    listPatches: async () => [{ rev, timestamp, patch_id: "x", intent: "", source_uri: "" }],
    // Unused by detectStaleFiles now, but stubbed so these tests can also be run
    // against the previous implementation, which called it and discarded the
    // result. Without it every case fails on a missing method rather than on the
    // behaviour under test, which would make the comparison worthless.
    stats: async () => ({}),
  } as unknown as IxClient;
}

describe("detectStaleFiles is scoped to the workspace it was asked about", () => {
  it("reports a modified file as stale", async () => {
    const a = seedWorkspace("a");
    touch(a.file);

    const info = await detectStaleFiles(fakeClient(1, new Date().toISOString()), a.root);

    expect(info.staleFiles).toBe(1);
    expect(info.sampleChangedFiles).toEqual(["a.js"]);
    rmSync(a.root, { recursive: true, force: true });
  });

  // The reported bug. Mapping an unrelated workspace advanced the newest patch,
  // and because the comparison used that patch's timestamp rather than anything
  // belonging to workspace A, every file in A fell behind it and A was declared
  // current — while still being genuinely modified.
  it("stays stale when an unrelated workspace is mapped afterwards", async () => {
    const a = seedWorkspace("a");
    touch(a.file);

    const before = await detectStaleFiles(fakeClient(1, new Date().toISOString()), a.root);
    expect(before.staleFiles).toBe(1);

    // Workspace B is mapped: a newer patch, at a later timestamp, and B gets its
    // own ingest record. Nothing about A changed.
    const b = seedWorkspace("b");
    const after = await detectStaleFiles(
      fakeClient(2, new Date(Date.now() + 60_000).toISOString()),
      a.root
    );

    expect(after.staleFiles).toBe(1);
    expect(after.sampleChangedFiles).toEqual(["a.js"]);
    // The graph revision is shared by every workspace and is expected to move.
    // Reporting it was never the bug; reporting B's staleness for A was.
    expect(after.currentRev).toBe(2);

    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  });

  it("takes lastIngestAt from this workspace, not from the newest patch anywhere", async () => {
    const a = seedWorkspace("a");
    // A patch timestamped a year out. The old code echoed this back as "last
    // ingest" for whatever root it was handed.
    const distant = new Date(Date.now() + 365 * 24 * 3600_000).toISOString();

    const info = await detectStaleFiles(fakeClient(2, distant), a.root);

    expect(info.lastIngestAt).not.toBe(distant);
    // It is the ingest record for this root, written when this root was mapped.
    const written = statSync(ingestMtimeCachePath(a.root)).mtime.toISOString();
    expect(info.lastIngestAt).toBe(written);

    rmSync(a.root, { recursive: true, force: true });
  });

  it("treats a root with no ingest record as having nothing to be stale against", async () => {
    const root = mkdtempSync(join(tmpdir(), "ix-ws-never-"));
    writeFileSync(join(root, "x.js"), "export const x = 1;\n");

    const info = await detectStaleFiles(fakeClient(7, new Date().toISOString()), root);

    expect(info.lastIngestAt).toBeNull();
    expect(info.staleFiles).toBe(0);
    // Still reports the graph revision — that part is genuinely global.
    expect(info.currentRev).toBe(7);

    rmSync(root, { recursive: true, force: true });
  });

  it("counts a file that did not exist at ingest time", async () => {
    // Absent from the baseline is new, and new is stale — the same conclusion
    // ingest reaches, since a path with no cached mtime is never skipped.
    const a = seedWorkspace("a");
    writeFileSync(join(a.root, "added.js"), "export const added = 1;\n");

    const info = await detectStaleFiles(fakeClient(1, new Date().toISOString()), a.root);

    expect(info.sampleChangedFiles).toContain("added.js");
    rmSync(a.root, { recursive: true, force: true });
  });
});
