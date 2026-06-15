// `stigmer internal-daemon` (hidden) — the long-lived supervised daemon process
// that `up` re-execs. It is not meant to be invoked directly; it runs the local
// stack until it receives SIGTERM/SIGINT, then exits with the daemon's code.

import type { Command } from "commander";

export function registerInternalDaemon(program: Command): void {
  program
    .command("internal-daemon", { hidden: true })
    .description("internal: run the supervised local-stack daemon (do not invoke directly)")
    .action(async () => {
      const { runInternalDaemon } = await import("../local/daemon/process.js");
      const code = await runInternalDaemon({ waitForShutdown: waitForShutdownSignal });
      process.exit(code);
    });
}

// Resolve when the first SIGTERM/SIGINT arrives — the daemon's shutdown trigger.
function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = (): void => resolve();
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  });
}
