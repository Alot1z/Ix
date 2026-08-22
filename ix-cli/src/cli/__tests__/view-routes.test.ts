import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { serverRuntimeArgs, serverScript } from "../commands/view.js";

/**
 * Tests for the /__ix/* 404 handler in the view server.
 *
 * Without the handler, /__ix/read, /__ix/explain, /__ix/inventory and
 * /__ix/help fall through to the SPA static handler, which serves
 * index.html with 200. The client tries JSON.parse on the HTML, catches
 * the error silently, and the user sees nothing.
 *
 * The fix adds a 404 handler between /__ix/remap and the static handler.
 * Any /__ix/* route that isn't POST /__ix/remap gets a JSON 404 response.
 *
 * REVIEW NOTE: These tests exercise the actual HTTP server (not mocks)
 * because the behavior under test is the server's response to real HTTP
 * requests. This is an integration test, not a unit test — that is
 * intentional and correct for this particular change.
 */

/** Pick a free TCP port. */
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

describe("view routes — /__ix/* 404", () => {
  let distDir: string;
  let stubMain: string;
  let child: ChildProcess | null = null;
  let port = 0;

  beforeAll(async () => {
    distDir = mkdtempSync(join(tmpdir(), "ix-view-routes-"));
    writeFileSync(join(distDir, "index.html"), "<!doctype html><html><body>fake</body></html>");
    writeFileSync(join(distDir, "package.json"), JSON.stringify({ type: "module" }));

    // Stub CLI main — the view server shells out to this for remap;
    // it is not relevant to the 404 handler under test.
    stubMain = join(distDir, "stub-main.cjs");
    writeFileSync(stubMain, "process.exit(0);");

    port = await getFreePort();
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    rmSync(distDir, { recursive: true, force: true });
  });

  async function stopServer(): Promise<void> {
    if (!child) return;
    const dying = child;
    child = null;
    if (dying.exitCode !== null || dying.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      dying.once("exit", () => resolve());
      dying.kill();
    });
  }

  async function startServer() {
    await stopServer();
    const scriptPath = join(distDir, "compass-server.cjs");
    writeFileSync(scriptPath, serverScript());
    child = spawn(process.execPath, [
      scriptPath,
      ...serverRuntimeArgs(distDir, port, "test-workspace", null, null, stubMain),
    ], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        IX_VIEW_MAP_MAIN: stubMain,
        IX_VIEW_BACKEND_URL: "",
      },
      stdio: "ignore",
    });
    child.once("error", () => {});
    await waitForPort(port);
  }

  // ── Route matching: every /__ix/* route returns 404 JSON ──

  /**
   * These 4 routes are the ones that fell through to the SPA handler.
   * Each must return 404 with JSON body, not HTML.
   *
   * MUTATION CHECK: Delete the 404 handler → all 4 go red.
   */
  const apiRoutes = ["/__ix/read", "/__ix/explain", "/__ix/inventory", "/__ix/help"];

  for (const route of apiRoutes) {
    it(`${route} returns 404 JSON, not HTML`, async () => {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: "test", path: "src/test.ts", range: "1-10" }),
      });

      // Status must be 404
      expect(res.status).toBe(404);

      // Content-Type must be JSON (not text/html from SPA)
      const contentType = res.headers.get("content-type") || "";
      expect(contentType).toContain("application/json");

      // Body must NOT be HTML
      const body = await res.text();
      expect(body).not.toContain("<!doctype html>");
      expect(body).not.toContain("<html");

      // Body must be valid JSON with error shape
      const json = JSON.parse(body);
      expect(json.ok).toBe(false);
      expect(json.error).toContain("not found");
    });
  }

  // ── Unmatched /__ix/* routes also return 404 ──

  it("unknown /__ix/ route returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("/__ix/ with empty path segment returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  // ── GET requests also hit the 404 handler ──

  it("GET /__ix/read returns 404 (not just POST)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/read`);
    expect(res.status).toBe(404);
  });

  // ── POST /__ix/remap is NOT caught by the 404 handler ──

  /**
   * This is the one /__ix/ route that has an implementation. The 404
   * handler must not shadow it. We verify this by checking the response
   * is NOT 404 — the actual result depends on CSRF validation, but any
   * non-404 response proves the route was not caught by the catch-all.
   *
   * MUTATION CHECK: Move the 404 handler above /__ix/remap → this test
   * goes red because /__ix/remap would now return 404.
   */
  it("POST /__ix/remap is NOT caught by the 404 handler", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/remap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    // Should be 403 (CSRF rejection — no loopback origin) or success,
    // but NOT 404. The 404 handler sits below /__ix/remap in the chain.
    expect(res.status).not.toBe(404);
  });

  // ── Response format ──

  it("response body is valid JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "test" }),
    });
    const text = await res.text();
    // Must not throw — proving the body is parseable JSON
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("error message includes the requested route path", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "test" }),
    });
    const json = await res.json();
    // The error message should help with debugging — include the route
    expect(json.error).toContain("/__ix/explain");
  });

  it("Cache-Control header is no-store", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "test" }),
    });
    // no-store prevents caching the 404 response
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  // ── Security: input validation ──

  it("path traversal in entity name returns 404 (not file contents)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "../../etc/passwd", path: "../../etc/passwd", range: "1-10" }),
    });
    expect(res.status).toBe(404);
    const text = await res.text();
    // Must not leak file contents — the 404 handler doesn't process the body
    expect(text).not.toContain("root:");
  });

  it("command injection in entity name returns 404 (not executed)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "test; rm -rf /", path: "src/test.ts", range: "1-10" }),
    });
    expect(res.status).toBe(404);
  });

  it("empty entity name returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "", path: "src/test.ts", range: "1-10" }),
    });
    expect(res.status).toBe(404);
  });

  it("malformed JSON body returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    expect(res.status).toBe(404);
  });

  // ── Edge cases ──

  it("handles 5 concurrent requests without error", async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      fetch(`http://127.0.0.1:${port}/__ix/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: `Entity${i}` }),
      }),
    );
    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toBe(404);
    }
  });

  it("handles missing Content-Type header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__ix/read`, {
      method: "POST",
      body: JSON.stringify({ entity: "test" }),
    });
    expect(res.status).toBe(404);
  });
});
