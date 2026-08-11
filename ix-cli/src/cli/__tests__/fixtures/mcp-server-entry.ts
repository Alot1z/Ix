/**
 * Test-only entry point: invokes runStdioMcpServer so the integration test can
 * spawn a real server process under tsx. (stdio-main.ts deliberately has no
 * top-level side effects — it is also imported by the `ix mcp` command action,
 * which must not start a second server on import.)
 */

import { runStdioMcpServer } from "../../mcp/stdio-main.js";

runStdioMcpServer().catch((err: unknown) => {
  process.stderr.write(`ix mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
