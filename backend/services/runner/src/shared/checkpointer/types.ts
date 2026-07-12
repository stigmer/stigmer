/**
 * Configuration for the checkpointer factory.
 *
 * Three backends are supported:
 * - sqlite: durable local file (OSS / local / desktop default) — survives across
 *   ExecuteDeepAgent invocations so HITL/pause/transient-recovery truly resume.
 * - http:   routes through the Stigmer Side-Channel Proxy (cloud / managed).
 * - memory: ephemeral in-process storage — explicit opt-in, used by tests.
 */
export interface CheckpointerConfig {
  readonly type: "memory" | "http" | "sqlite";
  readonly proxyEndpoint?: string;
  readonly authToken?: string;
  /** Absolute path to the SQLite database file. Required when type is "sqlite". */
  readonly sqlitePath?: string;
}
