// `stigmer internal-daemon` (hidden) — the long-lived supervised daemon process
// that `up` re-execs. It is not meant to be invoked directly; it runs the local
// stack until it receives SIGTERM/SIGINT, then exits with the daemon's code.
// (`stigmer up --foreground` runs the same body in the launching process.)

import type { Command } from "commander";

export function registerInternalDaemon(program: Command): void {
  program
    .command("internal-daemon", { hidden: true })
    .description("internal: run the supervised local-stack daemon (do not invoke directly)")
    .action(async () => {
      const { runInternalDaemon, waitForShutdownSignal } = await import("../local/daemon/process.js");
      const code = await runInternalDaemon({ waitForShutdown: waitForShutdownSignal });
      process.exit(code);
    });
}
