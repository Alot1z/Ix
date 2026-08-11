// Deterministic stand-in for `ix <cmd> --format llm`, used by the stdio
// integration test. The CliToolExecutor spawns `node <this-file> <cmd> ...`
// when IX_MCP_CLI_MAIN points here, so the MCP server's tool calls produce
// stable output without a backend.
//
// writeSync(1, ...) is used deliberately: process.stdout.write is async and
// process.exit(0) can truncate it; a synchronous write to fd 1 is atomic.
// `globalThis.process` (instead of bare `process`) keeps the flat eslint
// config happy: it has no node globals for .mjs files.

import { writeSync } from "node:fs";

const argv = globalThis.process.argv;
const cmd = argv[2] ?? "unknown";
writeSync(1, `mock ${cmd} rev=1\n`);
writeSync(1, `mock ${cmd} record=ok label="Fixture output"\n`);
globalThis.process.exit(0);
