// Canonical machine-readable definition of the manager-mode IPC contract.
// The runner emits these messages; the Rust host crate (crates/stigmer-runner-host/src/
// protocol.rs) and the Go integration harness (unified_runner.go) hand-mirror them. Those
// mirrors are kept honest by golden fixtures generated from this file via
// ipc-protocol-fixtures.ts (run `make gen-ipc-fixtures`). Full spec and the rule for keeping
// all definitions in sync: docs/ipc-protocol.md.

// Integer protocol version advertised in the `ready` handshake. Bump ONLY on a
// breaking change (removed/renamed message, changed field type, changed lifecycle
// guarantee) — additive fields never bump it. Hosts read this to decide compatibility;
// the runner never reads a version from the host (one-way advertisement).
export const IPC_PROTOCOL_VERSION = 1;

// ─── Commands (host → runner) ───────────────────────────────────────────────

export interface IpcAddSession {
  type: "addSession";
  sessionId: string;
}

export interface IpcRemoveSession {
  type: "removeSession";
  sessionId: string;
}

export interface IpcAddWorkflowExecution {
  type: "addWorkflowExecution";
  executionId: string;
}

export interface IpcRemoveWorkflowExecution {
  type: "removeWorkflowExecution";
  executionId: string;
}

export interface IpcUpdateToken {
  type: "updateToken";
  token: string | null;
}

export interface IpcShutdown {
  type: "shutdown";
}

export type IpcCommand =
  | IpcAddSession
  | IpcRemoveSession
  | IpcAddWorkflowExecution
  | IpcRemoveWorkflowExecution
  | IpcUpdateToken
  | IpcShutdown;

// ─── Responses (runner → host) ──────────────────────────────────────────────

export interface IpcReady {
  type: "ready";
  protocolVersion: number;
}

export interface IpcSessionAdded {
  type: "sessionAdded";
  sessionId: string;
  taskQueue: string;
}

export interface IpcSessionRemoved {
  type: "sessionRemoved";
  sessionId: string;
}

export interface IpcWorkflowExecutionAdded {
  type: "workflowExecutionAdded";
  executionId: string;
  taskQueue: string;
}

export interface IpcWorkflowExecutionRemoved {
  type: "workflowExecutionRemoved";
  executionId: string;
}

export interface IpcError {
  type: "error";
  message: string;
  fatal: boolean;
}

export interface IpcTokenUpdated {
  type: "tokenUpdated";
}

export interface IpcShutdownComplete {
  type: "shutdownComplete";
}

export type IpcResponse =
  | IpcReady
  | IpcSessionAdded
  | IpcSessionRemoved
  | IpcWorkflowExecutionAdded
  | IpcWorkflowExecutionRemoved
  | IpcTokenUpdated
  | IpcError
  | IpcShutdownComplete;

// ─── Message builders ────────────────────────────────────────────────────────

// `ready` is the only message carrying protocol metadata, so it is the only one with a
// constructor — a pure, importable seam the unit test asserts against (main.ts itself
// self-executes and is not unit-testable). Every other message is a trivial inline literal.
export function buildReadyMessage(): IpcReady {
  return { type: "ready", protocolVersion: IPC_PROTOCOL_VERSION };
}
