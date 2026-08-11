/**
 * `ix mcp` — expose ix as a local MCP (Model Context Protocol) server.
 *
 * The default (and only transport today) is stdio: MCP-aware AI clients
 * (Claude Code, Cursor, OpenCode, MCP Inspector, ...) launch `ix mcp` as a
 * subprocess and call the ix code-graph commands as tools. No network
 * surface is opened — same loopback discipline as the view server (F-010).
 *
 * Registration discipline follows F-009: the command is registered in
 * registerOssCommands (oss.ts) and is deliberately NOT part of PRO_COMMANDS,
 * so it can never be shadowed by a Pro stub. A regression test pins this.
 */

import { Command } from "commander";
import { TOOLS } from "../mcp/tools.js";
import { runStdioMcpServer } from "../mcp/stdio-main.js";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description(
      "Expose ix as a local MCP (Model Context Protocol) server over stdio — " +
        "MCP-aware AI clients call the ix code-graph commands (map, status, explain, trace, impact, search, rank) as tools",
    )
    .option("--stdio", "Serve MCP over standard input/output (default)")
    .option("--list-tools", "Print the MCP tool registry as JSON and exit")
    .addHelpText(
      "after",
      `
Runs an MCP stdio server (newline-delimited JSON-RPC 2.0 over stdin/stdout).
Connect from Claude Code, Cursor, or OpenCode via .mcp.json:

  {
    "mcpServers": {
      "ix": { "command": "ix", "args": ["mcp", "--stdio"] }
    }
  }

Protocol: MCP 2026-07-28 (stateless, per-request _meta) with the legacy
initialize handshake for older clients. Tools are read-only queries against
the code graph; the client has the same power as the user at the terminal.

Examples:
  ix mcp --list-tools`,
    )
    .action(async (opts: { stdio?: boolean; listTools?: boolean }) => {
      if (opts.listTools) {
        console.log(
          JSON.stringify(
            TOOLS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
            null,
            2,
          ),
        );
        return;
      }
      await runStdioMcpServer();
    });
}
