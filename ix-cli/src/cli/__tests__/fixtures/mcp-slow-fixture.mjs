// Never exits on its own. The CliToolExecutor's timeout path must kill it and
// report timedOut. `globalThis.setInterval` keeps the event loop alive.

globalThis.setInterval(() => {
  // keep the process alive until the executor kills it
}, 1 << 30);
