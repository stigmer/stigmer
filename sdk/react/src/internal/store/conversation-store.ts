// The conversation's live state for one session: the session's event log,
// folded (`SessionLog` from @stigmer/sdk), plus the follow's lifecycle stage
// and its two watchdog signals. Frames go into the log as they arrive; the
// fold is published to React only when the stream controller flushes, so a
// burst of frames commits once. The fold itself keeps every turn, item and
// thread object no event touched, so a published snapshot shares unchanged
// objects by reference with the one before it and only the changed rows
// re-render. Implements the contract `useSyncExternalStore` reads.

import { SessionLog, type SessionFold } from "@stigmer/sdk";
import type { StreamSessionEventsResponse } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

// ---------------------------------------------------------------------------
// Stream state
// ---------------------------------------------------------------------------

/**
 * Where a session follow stands. A follow never completes on its own: the
 * session can take another turn at any time, so it stays `streaming` until it
 * is stopped (`idle`) or refused (`error`).
 */
export type StreamState =
  | { readonly stage: "idle" }
  | { readonly stage: "connecting"; readonly sessionId: string }
  | { readonly stage: "streaming"; readonly sessionId: string }
  | {
      /**
       * The stream dropped and the follow is reconnecting in the background.
       * The last fold stays visible and no error is surfaced. `attempt` is the
       * 1-based count of reconnects since the last frame.
       */
      readonly stage: "reconnecting";
      readonly sessionId: string;
      readonly attempt: number;
    }
  | {
      /** The follow was refused (not found, permission denied, ...) and ended. */
      readonly stage: "error";
      readonly sessionId: string;
      readonly error: Error;
    };

const IDLE_STATE: StreamState = { stage: "idle" };

// ---------------------------------------------------------------------------
// ConversationStore
// ---------------------------------------------------------------------------

type Listener = () => void;

/**
 * Framework-agnostic store for one session's conversation: its folded event
 * log and the follow's lifecycle. Listeners are notified only when a value
 * they can read changed; every getter returns a stable reference.
 */
export class ConversationStore {
  private _log = new SessionLog();
  private _fold: SessionFold | null = null;
  private _streamState: StreamState = IDLE_STATE;
  private _connectTimedOut = false;
  private _isSlow = false;
  private _listeners = new Set<Listener>();

  // -- Ingestion -----------------------------------------------------------

  /**
   * Folds one stream frame (an event or a live preview) into the log. Nothing
   * is published until {@link publish}; returns whether the frame changed the
   * fold.
   */
  applyFrame(frame: StreamSessionEventsResponse): boolean {
    return this._log.applyFrame(frame);
  }

  /**
   * Publishes the log's current fold. Listeners are notified only when the
   * snapshot differs from the published one (the log returns the same
   * snapshot while nothing changed).
   */
  publish(): void {
    const next = this._log.snapshot();
    if (next === this._fold) return;
    this._fold = next;
    this._notify();
  }

  /** The newest event's place in the log: where a resumed follow starts. */
  get lastSeq(): bigint {
    return this._log.snapshot().lastSeq;
  }

  /** Transition the follow's lifecycle; listeners hear only a real change. */
  setStreamState(state: StreamState): void {
    if (streamStateEqual(this._streamState, state)) return;
    this._streamState = state;
    this._notify();
  }

  /**
   * Set the hard connect-timeout signal: the follow opened but no frame
   * arrived within the watchdog window, even after one silent reconnect.
   * Orthogonal to the lifecycle stage; booleans are stable by value.
   */
  setConnectTimedOut(value: boolean): void {
    if (this._connectTimedOut === value) return;
    this._connectTimedOut = value;
    this._notify();
  }

  /**
   * Set the soft slow-stall hint: no frame arrived for the slow window.
   * Purely informational; cleared by the next frame.
   */
  setSlow(value: boolean): void {
    if (this._isSlow === value) return;
    this._isSlow = value;
    this._notify();
  }

  /** Start over with an empty log, for another session. */
  reset(): void {
    const wasClean =
      this._fold === null &&
      this._streamState.stage === "idle" &&
      !this._connectTimedOut &&
      !this._isSlow;
    this._log = new SessionLog();
    this._fold = null;
    this._streamState = IDLE_STATE;
    this._connectTimedOut = false;
    this._isSlow = false;
    if (!wasClean) this._notify();
  }

  // -- useSyncExternalStore contract ---------------------------------------

  /** Subscribe a listener to every change; returns the unsubscribe. */
  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /** The published fold, or `null` before the first publish. */
  getFold = (): SessionFold | null => {
    return this._fold;
  };

  /** The follow's lifecycle stage. */
  getStreamState = (): StreamState => {
    return this._streamState;
  };

  /** The hard connect-timeout signal. */
  getConnectTimedOut = (): boolean => {
    return this._connectTimedOut;
  };

  /** The soft slow-stall hint. */
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
  if (a.stage === "idle" || b.stage === "idle") return true;
  if (a.sessionId !== b.sessionId) return false;
  if (a.stage === "error" && b.stage === "error") return a.error === b.error;
  // Each reconnect bumps `attempt`, and every attempt must re-notify.
  if (a.stage === "reconnecting" && b.stage === "reconnecting") return a.attempt === b.attempt;
  return true;
}
