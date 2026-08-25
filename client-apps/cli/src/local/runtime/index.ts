// Public surface of the runtime-acquisition seams (DD-002/003/007).

export { resolveNode, resolveServerNode } from "./node.js";
export {
  type EnsureRunnerOptions,
  type RunnerResolution,
  acquireRunner,
  ensureRunner,
  resolveRunner,
} from "./runner.js";
// The TS server — the served implementation since the DD-006 cutover (D4 #24).
export {
  type EnsureServerOptions,
  acquireServer,
  ensureServer,
  resolveServerTs,
} from "./server-ts.js";
// The Go binary ladder — the rollback path until #25 go-server-retirement.
export {
  type EnsureServerBinaryOptions,
  type ServerDownloadTarget,
  downloadServerBinary,
  ensureServerBinary,
  resolveServerBinary,
} from "./server.js";
export { which } from "./which.js";
