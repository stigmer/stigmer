/**
 * Entry point of a sandbox that waits to be attached: `node <dist>/attach/main.js`.
 *
 * It starts the attach waiter and nothing else; `waiter.ts` says why a
 * sandbox snapshot holds a waiter and never a runner, and `entry.ts` holds
 * the configuration and the signal handling. It imports none of the runner's
 * modules, so the snapshot holds a small idle process. This file is only the
 * process boundary; `scripts/verify-attach-boot.mjs` boots it under plain
 * Node.
 */

import { runAttachEntry } from "./entry.js";

/* v8 ignore start -- @preserve: the process boundary; its logic is entry.ts (tested) and scripts/verify-attach-boot.mjs boots this file under plain Node */
runAttachEntry(process.env, {
  onSignal: (signal, handler) => process.on(signal, handler),
  exit: (code) => process.exit(code),
  log: (message) => console.warn(message),
}).catch((err: unknown) => {
  console.error("[attach] fatal:", err);
  process.exit(1);
});
/* v8 ignore stop */
