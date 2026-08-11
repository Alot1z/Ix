// Grandchild fixture for orphan-reaping tests.
//
// Stays alive until killed. Spawns a non-detached grandchild (same process
// group on POSIX — exactly what a real tool spawning the indexing backend
// would do) and records both PIDs to files so the test can assert that a
// timeout / cancel / disposeAll killed the whole tree, not just this process.
//
// The PID-file paths come from the environment (inherited through the
// executor's spawn): IX_MCP_TEST_GRAND_PID and IX_MCP_TEST_OWN_PID.
// globalThis.* is used for globals so the flat eslint config (no-undef) is
// happy — the same pattern as the other .mjs fixtures.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const grandPidFile = globalThis.process.env.IX_MCP_TEST_GRAND_PID;
const ownPidFile = globalThis.process.env.IX_MCP_TEST_OWN_PID;

if (grandPidFile) {
  const grand = spawn(
    globalThis.process.execPath,
    [
      "-e",
      `const fs = require("fs"); fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);`,
      grandPidFile,
    ],
    { stdio: "ignore" },
  );
  grand.unref();
}

if (ownPidFile) {
  writeFileSync(ownPidFile, String(globalThis.process.pid));
}
globalThis.setInterval(() => {}, 1000);
