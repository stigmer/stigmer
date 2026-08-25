// Public surface of the runtime-acquisition seams (DD-002/003/007).

export { resolveNode, resolveServerNode } from "./node.js";
export {
  type EnsureRunnerOptions,
  type RunnerResolution,
  acquireRunner,
  ensureRunner,
  resolveRunner,
} from "./runner.js";
// The TS server — the served implementation since the DD-006 cutover (D4 #24;
// the Go binary ladder that backed rollback retired with #25).
export {
  type EnsureServerOptions,
  acquireServer,
  ensureServer,
  resolveServerTs,
} from "./server.js";
export { which } from "./which.js";
