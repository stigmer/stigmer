import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { StreamState } from "./store/conversation-store";
import { isTerminalPhase } from "../execution/execution-phases";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The controller's FSM state is exactly the store's `StreamState` — they
// were once duplicated unions kept in lock-step by hand. The controller
// reuses the store's type so the lifecycle (including the `reconnecting`
// stage) is defined in one place and can never drift.

const IDLE: StreamState = { stage: "idle" };

/**
 * Callback interface for the stream controller to communicate with
 * its host (the React hook). All mutations to external state go
 * through these callbacks.
 */
export interface StreamControllerSink {
  /** Ingest a snapshot into the store (applies structural sharing). */
  ingestSnapshot(snapshot: AgentExecution): void;
  /** Transition the store's stream lifecycle state. */
  setStreamState(state: StreamState): void;
}

// ---------------------------------------------------------------------------
// StreamController
// ---------------------------------------------------------------------------

/**
 * Framework-agnostic finite state machine that manages the lifecycle
 * of a single execution stream subscription.
 *
 * Responsibilities:
 * - Track FSM state transitions (idle → connecting → streaming → complete/error)
 * - Buffer incoming snapshots and coalesce via `requestAnimationFrame`
 * - Flush terminal snapshots immediately (no rAF delay)
 * - Provide abort/reconnect semantics
 *
 * This class has no React dependency. It communicates outward through
 * a {@link StreamControllerSink} and a `scheduleFlush` function
 * (typically `requestAnimationFrame`).
 */
export class StreamController {
  private _state: StreamState = IDLE;
  private _bufferedSnapshot: AgentExecution | null = null;
  private _rafId: number | null = null;
  private _sink: StreamControllerSink;
  private _scheduleFlush: (cb: () => void) => number;
  private _cancelFlush: (id: number) => void;

  constructor(
    sink: StreamControllerSink,
    scheduleFlush: (cb: () => void) => number = typeof requestAnimationFrame !== "undefined"
      ? (cb: () => void) => requestAnimationFrame(cb)
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number,
    cancelFlush: (id: number) => void = typeof cancelAnimationFrame !== "undefined"
      ? (id: number) => cancelAnimationFrame(id)
      : (id: number) => clearTimeout(id),
  ) {
    this._sink = sink;
    this._scheduleFlush = scheduleFlush;
    this._cancelFlush = cancelFlush;
  }

  /** Current FSM state (read-only). */
  get state(): StreamState {
    return this._state;
  }

  /**
   * Transition to `connecting` for the given execution ID.
   * If already active for a different ID, resets first.
   */
  start(executionId: string): void {
    this._cancelPendingFlush();
    this._bufferedSnapshot = null;
    this._transition({ stage: "connecting", executionId });
  }

  /**
   * Handle an incoming snapshot from the gRPC stream.
   * Non-terminal snapshots are buffered for rAF coalescing.
   * Terminal snapshots flush immediately.
   */
  handleSnapshot(snapshot: AgentExecution): void {
    const executionId = this._activeExecutionId();
    if (!executionId) return;

    const phase =
      snapshot.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
    const terminal = isTerminalPhase(phase);

    if (terminal) {
      this._cancelPendingFlush();
      this._bufferedSnapshot = null;
      this._sink.ingestSnapshot(snapshot);
      this._transition({ stage: "complete", executionId });
    } else {
      // A snapshot proves the (re)connection is healthy: advance from either
      // the initial `connecting` or a `reconnecting` retry into `streaming`.
      if (
        this._state.stage === "connecting" ||
        this._state.stage === "reconnecting"
      ) {
        this._transition({ stage: "streaming", executionId });
      }
      this._bufferedSnapshot = snapshot;
      this._scheduleFlushOnce();
    }
  }

  /**
   * Enter the `reconnecting` stage after a transient drop. Unlike
   * {@link start}, this preserves the buffered snapshot and never resets the
   * store, so the last-known-good conversation stays on screen while the
   * background retry is in flight. No-op once idle (the subscription is
   * already torn down).
   */
  handleReconnecting(attempt: number, error: Error): void {
    const executionId = this._activeExecutionId();
    if (!executionId) return;
    this._transition({ stage: "reconnecting", executionId, attempt, error });
  }

  /**
   * Handle stream completion (iterator exhausted without error).
   * If we still have a buffered snapshot, flush it first.
   */
  handleStreamEnd(): void {
    const executionId = this._activeExecutionId();
    if (!executionId) return;

    this._flushBuffer();
    if (this._state.stage !== "complete") {
      this._transition({ stage: "complete", executionId });
    }
  }

  /**
   * Handle a stream error. Flushes any buffered snapshot first
   * so the UI shows the last known good state alongside the error.
   */
  handleError(error: Error): void {
    const executionId = this._activeExecutionId();
    if (!executionId) return;

    this._cancelPendingFlush();
    this._flushBuffer();
    this._transition({ stage: "error", executionId, error });
  }

  /** Reset to idle. Cancels any pending flush. */
  reset(): void {
    this._cancelPendingFlush();
    this._bufferedSnapshot = null;
    if (this._state.stage !== "idle") {
      this._transition(IDLE);
    }
  }

  /** Whether the controller has a buffered snapshot awaiting flush. */
  get hasPendingFlush(): boolean {
    return this._rafId !== null;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _activeExecutionId(): string | null {
    if (this._state.stage === "idle") return null;
    return this._state.executionId;
  }

  private _transition(next: StreamState): void {
    this._state = next;
    this._sink.setStreamState(next);
  }

  private _scheduleFlushOnce(): void {
    if (this._rafId !== null) return;
    this._rafId = this._scheduleFlush(() => {
      this._rafId = null;
      this._flushBuffer();
    });
  }

  private _flushBuffer(): void {
    if (this._bufferedSnapshot) {
      const snap = this._bufferedSnapshot;
      this._bufferedSnapshot = null;
      this._sink.ingestSnapshot(snap);
    }
  }

  private _cancelPendingFlush(): void {
    if (this._rafId !== null) {
      this._cancelFlush(this._rafId);
      this._rafId = null;
    }
  }
}
