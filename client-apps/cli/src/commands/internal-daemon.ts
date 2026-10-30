// `stigmer internal-daemon` (hidden) — the long-lived supervised daemon process
// that `up` re-execs. It is not meant to be invoked directly; it runs the local
// stack until it receives SIGTERM/SIGINT, then exits with the daemon's code.
// (`stigmer up --foreground` runs the same body in the launching process.)
//
// The stop request is armed as the action's first act, before the daemon body
// is imported: `stigmer down` may arrive while the stack is still starting,
// and a signal with no handler yet would end this process and orphan whatever
// it had started (stigmer#1175).

import type { Command } from "commander";
import { shutdownOnSignals } from "../local/daemon/signals.js";

export function registerInternalDaemon(program: Command): void {
  program
    .command("internal-daemon", { hidden: true })
    .description("internal: run the supervised local-stack daemon (do not invoke directly)")
    .action(async () => {
      const shutdown = shutdownOnSignals();
      const { runInternalDaemon } = await import("../local/daemon/process.js");
      const code = await runInternalDaemon({ shutdown });
      process.exit(code);
    });
}
