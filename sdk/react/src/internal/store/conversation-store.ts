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
  private _connectTimedOut = false;
  private _isSlow = false;
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
   * Set the hard connect-timeout signal — the stream opened but no first
   * snapshot arrived within the watchdog window even after a silent retry.
   *
   * Orthogonal to {@link setStreamState}: the stream may still be live, so
   * this is **not** a lifecycle stage and deliberately does not touch the
   * `error` stage (that is auto-reconnect's domain). Booleans are stable by
   * value, so no snapshot caching is needed; listeners fire only on change.
   */
  setConnectTimedOut(value: boolean): void {
    if (this._connectTimedOut === value) return;
    this._connectTimedOut = value;
    this._notify();
  }

  /**
   * Set the soft slow-stall hint — the stream is non-terminal but has gone
   * silent past the watchdog window. Purely informational ("still working,
   * taking longer than usual"); cleared by the next snapshot. Never aborts.
   */
  setSlow(value: boolean): void {
    if (this._isSlow === value) return;
    this._isSlow = value;
    this._notify();
  }

  /**
   * Reset to initial state. Used when the session identity changes
   * or the hook unmounts.
   */
  reset(): void {
    const wasClean =
      this._execution === null &&
      this._streamState.stage === "idle" &&
      !this._connectTimedOut &&
      !this._isSlow;
    this._execution = null;
    this._streamState = IDLE_STATE;
    this._connectTimedOut = false;
    this._isSlow = false;
    if (!wasClean) this._notify();
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

  /** Stable snapshot selector for the hard connect-timeout signal. */
  getConnectTimedOut = (): boolean => {
    return this._connectTimedOut;
  };

  /** Stable snapshot selector for the soft slow-stall hint. */
  getSlow = (): boolean => {
    return this._isSlow;
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
