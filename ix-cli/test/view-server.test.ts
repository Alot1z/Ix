import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import * as http from "node:http";
import { serverScript } from "../src/cli/commands/view.js";

/** Pick a free TCP port by binding port 0 and releasing it. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Wait until a TCP port accepts connections. */
async function waitForPort(port: number, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
      res.body?.cancel();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`server on port ${port} did not start`);
}

describe("view server (/__ix/remap)", () => {
  let distDir: string;
  let stubMain: string;
  let child: ChildProcess | null = null;
  let port = 0;
  const marker = join(process.cwd(), "stub-ran.txt");

  beforeAll(async () => {
    // A fake Compass dist: index.html is the SPA entry the fallback serves.
    distDir = mkdtempSync(join(tmpdir(), "ix-view-dist-"));
    writeFileSync(join(distDir, "index.html"), "<h1>fake compass</h1>");

    // A stub `ix` CLI main: the server runs `node <MAP_MAIN> map .`. Exit code
    // comes from STUB_EXIT (default 0), so both the success and failure paths
    // are testable without a real installation.
    stubMain = join(distDir, "stub-main.js");
    writeFileSync(
      stubMain,
      [
        'const fs = require("fs");',
        'fs.writeFileSync(require("path").join(process.cwd(), "stub-ran.txt"), "ok");',
        "process.exit(Number(process.env.STUB_EXIT || 0));",
      ].join("\n"),
    );

    port = await getFreePort();
    const script = serverScript(distDir, port, "test-workspace", null);
    // The generated script must survive template-literal emission intact.
    expect(script).toContain('"/__ix/remap"');
    expect(script).toContain("IX_VIEW_MAP_MAIN");
    expect(script).toContain('server.listen(PORT, "127.0.0.1"');

    const scriptPath = join(distDir, "compass-server.js");
    writeFileSync(scriptPath, script);
    await startServer({ STUB_EXIT: "0" });
    await waitForPort(port);
  });

  afterAll(() => {
    child?.kill();
    rmSync(marker, { force: true });
  });

  async function startServer(extraEnv: Record<string, string>) {
    child?.kill();
    const script = serverScript(distDir, port, "test-workspace", null);
    const scriptPath = join(distDir, "compass-server.js");
    writeFileSync(scriptPath, script);
    child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, IX_VIEW_MAP_MAIN: stubMain, ...extraEnv },
      stdio: "ignore",
    });
    await waitForPort(port);
  }

  const post = (path: string, headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers });

  it("rejects a cross-site Origin (CSRF) with 403", async () => {
    const res = await post("/__ix/remap", { origin: "https://evil.example", host: `127.0.0.1:${port}` });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden: loopback only" });
  });

  it("rejects a DNS-rebinding Host with 403", async () => {
    // fetch/undici refuses to send a custom Host header, so use http.request,
    // which lets the Host header differ from the connection target — the exact
    // DNS-rebinding scenario.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/__ix/remap", method: "POST", headers: { host: "attacker.example" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("rejects a malformed Origin with 403", async () => {
    const res = await post("/__ix/remap", { origin: "not a url", host: `127.0.0.1:${port}` });
    expect(res.status).toBe(403);
  });

  it("rejects a non-loopback Origin even when the Host is loopback", async () => {
    const res = await post("/__ix/remap", { origin: "http://10.0.0.5:8080", host: `127.0.0.1:${port}` });
    expect(res.status).toBe(403);
  });

  it("accepts a bracketed IPv6 loopback Host ([::1]:port)", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/__ix/remap", method: "POST", headers: { host: `[::1]:${port}` } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(200);
  });

  it("accepts a no-Origin (curl-style) POST and runs the map command", async () => {
    rmSync(marker, { force: true });
    const res = await post("/__ix/remap", { host: `127.0.0.1:${port}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(existsSync(marker)).toBe(true);
  });

  it("accepts a same-origin loopback Origin", async () => {
    const res = await post("/__ix/remap", { origin: `http://localhost:${port}`, host: `127.0.0.1:${port}` });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns ok:false when the map command fails", async () => {
    await startServer({ STUB_EXIT: "1" });
    const res = await post("/__ix/remap", { host: `127.0.0.1:${port}` });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("still serves the SPA index.html for unknown paths", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("fake compass");
  });

  it("does not treat GET /__ix/remap as the endpoint (SPA fallback)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/remap`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("fake compass");
  });
});
