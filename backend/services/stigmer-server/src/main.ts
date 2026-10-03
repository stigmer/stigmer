/**
 * Process entry for stigmer-server. The CLI's daemon launches this the
 * way it launches the runner: a node binary + bundled entry path, with the
 * env contract from daemon/env.ts (GRPC_PORT et al.) and a TCP readiness
 * probe on the bound port. A parent that passes port 0 asks for the ready
 * line instead (STIGMER_READY_LINE=stdout): the ports the listeners bound,
 * printed once they are listening (boot/ready-line.ts).
 *
 * SIGTERM/SIGINT run the composed shutdown (NOT_SERVING → drain → exit) —
 * the daemon stops components with signals, and in-flight requests get the
 * drain budget rather than a mid-write connection reset. The body is
 * boot/run.ts, which the test harness's library entry shares; this entry
 * composes the open-source edition's unit (editions/open-source.ts), so the
 * shipped server holds one organization.
 *
 * A promise chain, not top-level await, is load-bearing: the slim artifact
 * bundles this entry as CJS (scripts/bundle-slim.mjs), where top-level
 * await cannot exist.
 */
import { runServer } from "./boot/run.js";
import { openSourceEdition } from "./editions/open-source.js";

/* v8 ignore start -- main.ts runs only as the process entry, never under vitest; runServer's own tests drive the body, and scripts/verify-boot.mjs proves this entry on the built artifact */
runServer({ extensions: [openSourceEdition] }).catch((error: unknown) => {
  // The logger may not exist yet (config/compose failures) — stderr is the
  // one channel that always does.
  console.error(
    "boot failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
/* v8 ignore stop */
