// Golden wire-shape examples for the manager-mode IPC contract — one representative
// instance per message. This is the single source the cross-language mirrors assert
// against (Rust `protocol.rs`, Go `unified_runner.go`): the generator script serializes
// `buildFixtures()` to `fixtures/ipc-protocol.generated.json`, and each mirror's tests
// read that artifact. Because every sample is typed against an `Ipc*` interface from
// `ipc-protocol.ts`, renaming or retyping a field there fails `tsc` here — that compile
// error is what binds the fixtures to the contract. Full rules: docs/ipc-protocol.md.

import {
  IPC_PROTOCOL_VERSION,
  buildReadyMessage,
  type IpcAddSession,
  type IpcAddWorkflowExecution,
  type IpcError,
  type IpcReady,
  type IpcRemoveSession,
  type IpcRemoveWorkflowExecution,
  type IpcSessionAdded,
  type IpcSessionRemoved,
  type IpcShutdown,
  type IpcShutdownComplete,
  type IpcTokenUpdated,
  type IpcUpdateToken,
  type IpcWorkflowExecutionAdded,
  type IpcWorkflowExecutionRemoved,
} from "./ipc-protocol.js";

// Stable example identifiers shared by every mirror's tests. Keep them in sync with the
// values hard-coded in protocol.rs and ipc_fixtures_test.go — they are part of the golden
// artifact, so a change here regenerates the fixture and the mirrors must match it.
const SESSION_ID = "ses_example";
const EXECUTION_ID = "wfe_example";
const TOKEN = "tok_example";

/** The full golden fixture set: the protocol version plus every command and response. */
export interface IpcFixtures {
  ipcProtocolVersion: number;
  commands: {
    addSession: IpcAddSession;
    removeSession: IpcRemoveSession;
    addWorkflowExecution: IpcAddWorkflowExecution;
    removeWorkflowExecution: IpcRemoveWorkflowExecution;
    updateTokenSet: IpcUpdateToken;
    updateTokenCleared: IpcUpdateToken;
    shutdown: IpcShutdown;
  };
  responses: {
    ready: IpcReady;
    // A pre-version-1 runner that omits `protocolVersion`. Not an `IpcReady` (which now
    // requires the field), so it is typed as the legacy subset — hosts must treat it as
    // version 1. This is the backward-compatibility contract every host mirror tests.
    readyLegacy: Omit<IpcReady, "protocolVersion">;
    sessionAdded: IpcSessionAdded;
    sessionRemoved: IpcSessionRemoved;
    workflowExecutionAdded: IpcWorkflowExecutionAdded;
    workflowExecutionRemoved: IpcWorkflowExecutionRemoved;
    tokenUpdated: IpcTokenUpdated;
    error: IpcError;
    shutdownComplete: IpcShutdownComplete;
  };
}

// Builds the golden fixture set. `ready` uses the real builder so the artifact reflects
// the message the runner actually emits; every other message is a typed literal. Insertion
// order here is the artifact's key order — keep it stable so the freshness guard's textual
// diff stays meaningful (consumers compare semantically and do not depend on it).
export function buildFixtures(): IpcFixtures {
  return {
    ipcProtocolVersion: IPC_PROTOCOL_VERSION,
    commands: {
      addSession: { type: "addSession", sessionId: SESSION_ID },
      removeSession: { type: "removeSession", sessionId: SESSION_ID },
      addWorkflowExecution: {
        type: "addWorkflowExecution",
        executionId: EXECUTION_ID,
      },
      removeWorkflowExecution: {
        type: "removeWorkflowExecution",
        executionId: EXECUTION_ID,
      },
      updateTokenSet: { type: "updateToken", token: TOKEN },
      updateTokenCleared: { type: "updateToken", token: null },
      shutdown: { type: "shutdown" },
    },
    responses: {
      ready: buildReadyMessage(),
      readyLegacy: { type: "ready" },
      sessionAdded: {
        type: "sessionAdded",
        sessionId: SESSION_ID,
        taskQueue: `session:${SESSION_ID}`,
      },
      sessionRemoved: { type: "sessionRemoved", sessionId: SESSION_ID },
      workflowExecutionAdded: {
        type: "workflowExecutionAdded",
        executionId: EXECUTION_ID,
        taskQueue: `wfexec:${EXECUTION_ID}`,
      },
      workflowExecutionRemoved: {
        type: "workflowExecutionRemoved",
        executionId: EXECUTION_ID,
      },
      tokenUpdated: { type: "tokenUpdated" },
      error: { type: "error", message: "boom", fatal: true },
      shutdownComplete: { type: "shutdownComplete" },
    },
  };
}

/**
 * Serializes the fixtures to the exact text written to disk: 2-space JSON with a trailing
 * newline. Centralized so the writer and the `--check` guard format identically — any
 * difference would make the textual freshness diff falsely fail.
 */
export function serializeFixtures(): string {
  return `${JSON.stringify(buildFixtures(), null, 2)}\n`;
}
