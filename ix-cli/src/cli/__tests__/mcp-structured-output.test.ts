import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { createIxMcpServer, type IxRunner } from "../../mcp/server.js";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(runIx: IxRunner): Promise<Client> {
  const server = createIxMcpServer({ version: "test", runIx });
  const client = new Client({ name: "ix-mcp-structured-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

describe("ix mcp structured output", () => {
  it("exposes parsed JSON objects as structuredContent", async () => {
    const client = await connect(async () => ({
      ok: true,
      stdout: JSON.stringify({ file_count: 3, outcome: "complete" }),
      stderr: "",
    }));

    const result = (await client.callTool({ name: "ix_map", arguments: {} })) as CallToolResult;

    expect(result.structuredContent).toEqual({ file_count: 3, outcome: "complete" });
    // The human-readable text remains for clients that prefer it.
    expect(result.content[0]?.type).toBe("text");
  });

  it("falls back to an empty object without throwing when output is not JSON", async () => {
    const client = await connect(async () => ({
      ok: true,
      stdout: "not json at all",
      stderr: "",
    }));

    const result = (await client.callTool({ name: "ix_map", arguments: {} })) as CallToolResult;

    // A future backend emitting a non-object shape must not fail the tool call;
    // the raw text still carries the answer.
    expect(result.structuredContent).toEqual({});
    expect(result.content[0]).toEqual({ type: "text", text: "not json at all" });
  });

  it("exposes the filtered smell candidates as structuredContent", async () => {
    const client = await connect(async () => ({
      ok: true,
      stdout: JSON.stringify({
        rev: 1,
        run_at: "now",
        count: 2,
        candidates: [
          { file: "ix-cli/src/a.ts", smell: "orphan", confidence: 0.9, signals: ["x"] },
          { file: "src/b.ts", smell: "god_module", confidence: 0.8, signals: ["y"] },
        ],
      }),
      stderr: "",
    }));

    const result = (await client.callTool({ name: "ix_smells", arguments: { limit: 1 } })) as CallToolResult;

    const structured = result.structuredContent as { count: number; candidates: unknown[] };
    expect(structured.count).toBe(1);
    expect(structured.candidates).toHaveLength(1);
  });

  it("advertises outputSchema only for the verified JSON tools", async () => {
    const client = await connect(async () => ({ ok: true, stdout: "{}", stderr: "" }));
    const byName = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));

    for (const name of ["ix_map", "ix_ingest", "ix_smells"]) {
      expect(byName.get(name)?.outputSchema, name).toBeDefined();
    }
    // Tools whose `--format llm` output is human-oriented text have no stable
    // object schema to promise.
    expect(byName.get("ix_locate")?.outputSchema).toBeUndefined();
    expect(byName.get("ix_stats")?.outputSchema).toBeUndefined();
  });
});
