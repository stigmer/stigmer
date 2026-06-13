import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { structuralShare } from "./structural-share";

// ---------------------------------------------------------------------------
// Stream state
// ---------------------------------------------------------------------------

export type StreamState =
  | { readonly stage: "idle" }
  | { readonly stage: "connecting"; readonly executionId: string }
  | { readonly stage: "streaming"; readonly executionId: string }
  | {
      /**
       * A non-terminal stream drop is being retried in the background. The
       * last-known-good snapshot stays visible and no error is surfaced —
       * the public `error` only appears once retries are exhausted. `attempt`
       * is the 1-based retry count; `error` is the transient cause, retained
       * for diagnostics (it is not shown to the user while reconnecting).
       */
      readonly stage: "reconnecting";
      readonly executionId: string;
      readonly attempt: number;
      readonly error: Error;
    }
  | { readonly stage: "complete"; readonly executionId: string }
  | {
      readonly stage: "error";
      readonly executionId: string;
      readonly error: Error;
    };

const IDLE_STATE: StreamState = { stage: "idle" };

// ---------------------------------------------------------------------------
// ConversationStore
// ---------------------------------------------------------------------------

type Listener = () => void;

/**
 * Framework-agnostic store that holds the active execution snapshot
 * with structural sharing. Implements the contract required by
 * React's `useSyncExternalStore`.
 *
 * - `ingestSnapshot` applies structural sharing so unchanged nested
 *   entities keep their previous reference.
 * - Listeners are notified only when state actually changes.
 * - `getExecution` and `getStreamState` return stable references
 *   suitable as `useSyncExternalStore` snapshot selectors.
 */
export class ConversationStore {
  private _execution: AgentExecution | null = null;
  private _streamState: StreamState = IDLE_STATE;
  private _listeners = new Set<Listener>();

  // -- Ingestion -----------------------------------------------------------

  /**
   * Ingest a new execution snapshot. Applies structural sharing
   * against the previous snapshot and notifies listeners only if
   * the resulting reference changed.
   */
  ingestSnapshot(snapshot: AgentExecution): void {
    const shared = structuralShare(this._execution, snapshot);
    if (shared === this._execution) return;
    this._execution = shared;
    this._notify();
  }

  /**
   * Transition the stream lifecycle state. Notifies listeners only
   * when the stage or executionId actually changes.
   */
  setStreamState(state: StreamState): void {
    if (streamStateEqual(this._streamState, state)) return;
    this._streamState = state;
    this._notify();
  }

  /**
   * Reset to initial state. Used when the session identity changes
   * or the hook unmounts.
   */
  reset(): void {
    const wasIdle =
      this._execution === null && this._streamState.stage === "idle";
    this._execution = null;
    this._streamState = IDLE_STATE;
    if (!wasIdle) this._notify();
  }

  // -- useSyncExternalStore contract ---------------------------------------

  /**
   * Subscribe a listener that is called whenever any store state
   * changes. Returns an unsubscribe function.
   */
  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /** Stable snapshot selector for the current execution. */
  getExecution = (): AgentExecution | null => {
    return this._execution;
  };

  /** Stable snapshot selector for the stream lifecycle state. */
  getStreamState = (): StreamState => {
    return this._streamState;
  };

  // -- Internal ------------------------------------------------------------

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function streamStateEqual(a: StreamState, b: StreamState): boolean {
  if (a.stage !== b.stage) return false;
  if (a.stage === "idle") return true;
  if (
    a.stage === "error" &&
    b.stage === "error" &&
    a.executionId === b.executionId &&
    a.error === b.error
  )
    return true;
  // Each retry bumps `attempt`, so two reconnecting states are only equal
  // when the attempt matches — every attempt must re-notify subscribers.
  if (
    a.stage === "reconnecting" &&
    b.stage === "reconnecting" &&
    a.executionId === b.executionId &&
    a.attempt === b.attempt
  )
    return true;
  if ("executionId" in a && "executionId" in b)
    return a.executionId === b.executionId;
  return false;
}
