/**
 * Configuration for the checkpointer factory.
 *
 * Three backends are supported:
 * - sqlite: durable local file (OSS / local / desktop default) — survives across
 *   ExecuteDeepAgent invocations so HITL/pause/transient-recovery truly resume.
 * - http:   routes through the Stigmer Side-Channel Proxy (cloud / managed).
 * - memory: ephemeral in-process storage — explicit opt-in, used by tests.
 * - relayed: the sqlite backend's rows, stored by the runner for a turn the
 *   locked agent host runs, which opens no file (`relayed-rows.ts`).
 *
 * The http backend's credential is a shared ref, never a string: the saver
 * reads it per request, so a rotation of the runner's control-plane
 * credential (a sandbox-token renewal, a host refresh) reaches a checkpoint
 * written after it — including mid-turn, since a saver lives for a whole
 * turn (config.ts header; the artifact store holds its credential the same
 * way).
 */

import type { TokenRef } from "../../config.js";
import type { CheckpointRows } from "./rows.js";

export interface CheckpointerConfig {
  readonly type: "memory" | "http" | "sqlite" | "relayed";
  readonly proxyEndpoint?: string;
  /** The credential the http saver presents, read per request. Required when type is "http". */
  readonly authToken?: Readonly<TokenRef>;
  /** Absolute path to the SQLite database file. Required when type is "sqlite". */
  readonly sqlitePath?: string;
  /** The rows the runner stores for a locked agent host (`relayed-rows.ts`). Required when type is "relayed". */
  readonly rows?: CheckpointRows;
}
