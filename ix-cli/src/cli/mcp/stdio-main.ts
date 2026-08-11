/**
 * Production stdio entry for `ix mcp`. Kept separate from the commander
 * command so the integration test can spawn it directly with tsx and a
 * deterministic fixture executor (IX_MCP_CLI_MAIN), the same seam the view
 * server uses (IX_VIEW_MAP_MAIN, F-010).
 */

import { CliToolExecutor } from "./cli-executor.js";
import { McpServer } from "./server.js";
import { TOOLS } from "./tools.js";

/** Serve MCP over process stdio until stdin closes. */
export async function runStdioMcpServer(): Promise<void> {
  const executor = new CliToolExecutor();
  const server = new McpServer({
    tools: TOOLS,
    executor,
    io: { input: process.stdin, output: process.stdout },
  });

  // Reap tool child trees when the process is asked to stop (SIGINT/SIGTERM).
  // Without this, a backend spawned by a tool call could outlive the server
  // if the client kills it outright instead of closing stdin.
  const shutdown = (): void => {
    executor.disposeAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await server.start();
  } finally {
    executor.disposeAll();
  }
}
