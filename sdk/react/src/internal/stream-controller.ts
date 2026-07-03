import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { StreamState } from "./store/conversation-store.js";
import { isTerminalPhase } from "../execution/execution-phases.js";
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
 * Hard connect-timeout: time the stream may stay `connecting` (no first
 * snapshot) before the watchdog acts. Sized well above a healthy connect
 * (the server sends the initial snapshot in ~1 RTT) yet short enough that a
 * silent hang surfaces an affordance within a few seconds, not minutes.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/**
 * Soft slow-stall threshold: a non-terminal stream that produces no new
 * snapshot for this long flips an informational "still working" hint. Long
 * enough that ordinary model thinking-time never trips it.
 */
export const DEFAULT_SLOW_THRESHOLD_MS = 60_000;

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
  /**
   * The hard connect-timeout elapsed while still `connecting`. The host owns
   * the self-heal-once-then-surface policy (it holds the `connectKey` reconnect
   * counter and the per-subscription guard that survives a reconnect, which
   * the controller — reset on every teardown — cannot).
   */
  onConnectTimeout(): void;
  /** Set or clear the soft slow-stall hint signal. */
  setSlow(value: boolean): void;
}

/**
 * Injectable watchdog configuration. Timers default to `setTimeout`/
 * `clearTimeout`; tests pass fakes so the watchdog is exercised without real
 * time. Mirrors the existing `scheduleFlush`/`cancelFlush` injection idiom.
 */
export interface StreamControllerWatchdog {
  readonly setTimer?: (cb: () => void, ms: number) => number;
  readonly clearTimer?: (id: number) => void;
  readonly connectTimeoutMs?: number;
  readonly slowThresholdMs?: number;
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

  // -- Watchdog ------------------------------------------------------------
  private _setTimer: (cb: () => void, ms: number) => number;
  private _clearTimer: (id: number) => void;
  private _connectTimeoutMs: number;
  private _slowThresholdMs: number;
  private _connectTimerId: number | null = null;
  private _slowTimerId: number | null = null;

  constructor(
    sink: StreamControllerSink,
    scheduleFlush: (cb: () => void) => number = typeof requestAnimationFrame !== "undefined"
      ? (cb: () => void) => requestAnimationFrame(cb)
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number,
    cancelFlush: (id: number) => void = typeof cancelAnimationFrame !== "undefined"
      ? (id: number) => cancelAnimationFrame(id)
      : (id: number) => clearTimeout(id),
    watchdog?: StreamControllerWatchdog,
  ) {
    this._sink = sink;
    this._scheduleFlush = scheduleFlush;
    this._cancelFlush = cancelFlush;
    this._setTimer =
      watchdog?.setTimer ??
      ((cb, ms) => setTimeout(cb, ms) as unknown as number);
    this._clearTimer = watchdog?.clearTimer ?? ((id) => clearTimeout(id));
    this._connectTimeoutMs =
      watchdog?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this._slowThresholdMs =
      watchdog?.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
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
    // Arm both watchdogs the moment we begin connecting. The connect-timeout
    // guards the first snapshot; the slow-stall hint guards every quiet stretch
    // thereafter. Both are reset by the next snapshot and cleared on any exit.
    this._armConnectTimer();
    this._armSlowTimer();
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
      this._cancelWatchdogs();
      this._sink.setSlow(false);
      this._cancelPendingFlush();
      this._bufferedSnapshot = null;
      this._sink.ingestSnapshot(snapshot);
      this._transition({ stage: "complete", executionId });
    } else {
      // A snapshot proves the (re)connection is healthy: the connect-timeout no
      // longer applies, and the slow-stall window restarts from now.
      this._cancelConnectTimer();
      this._armSlowTimer();
      // Advance from either the initial `connecting` or a `reconnecting` retry
      // into `streaming`.
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
    // Auto-reconnect (#174) has taken over with its own visible affordance and
    // bounded attempt budget, so the silence watchdogs stand down — they exist
    // for the case where the stream stalls *without* a drop. The slow hint is
    // cleared so "reconnecting" and "slow" never show at once.
    this._cancelWatchdogs();
    this._sink.setSlow(false);
    this._transition({ stage: "reconnecting", executionId, attempt, error });
  }

  /**
   * Handle stream completion (iterator exhausted without error).
   * If we still have a buffered snapshot, flush it first.
   */
  handleStreamEnd(): void {
    const executionId = this._activeExecutionId();
    if (!executionId) return;

    this._cancelWatchdogs();
    this._sink.setSlow(false);
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

    this._cancelWatchdogs();
    this._sink.setSlow(false);
    this._cancelPendingFlush();
    this._flushBuffer();
    this._transition({ stage: "error", executionId, error });
  }

  /** Reset to idle. Cancels any pending flush and watchdog timers. */
  reset(): void {
    this._cancelWatchdogs();
    this._sink.setSlow(false);
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

  // -- Watchdog timers ------------------------------------------------------

  private _armConnectTimer(): void {
    this._cancelConnectTimer();
    this._connectTimerId = this._setTimer(() => {
      this._connectTimerId = null;
      // Only meaningful while still awaiting the first snapshot; any later
      // stage has its own handling and has already cleared this timer.
      if (this._state.stage !== "connecting") return;
      this._sink.onConnectTimeout();
    }, this._connectTimeoutMs);
  }

  private _armSlowTimer(): void {
    this._cancelSlowTimer();
    // Re-arming means activity just resumed (or is starting), so a prior slow
    // hint no longer holds — clear it before counting the next quiet stretch.
    this._sink.setSlow(false);
    this._slowTimerId = this._setTimer(() => {
      this._slowTimerId = null;
      if (this._state.stage !== "connecting" && this._state.stage !== "streaming")
        return;
      this._sink.setSlow(true);
    }, this._slowThresholdMs);
  }

  private _cancelConnectTimer(): void {
    if (this._connectTimerId !== null) {
      this._clearTimer(this._connectTimerId);
      this._connectTimerId = null;
    }
  }

  private _cancelSlowTimer(): void {
    if (this._slowTimerId !== null) {
      this._clearTimer(this._slowTimerId);
      this._slowTimerId = null;
    }
  }

  private _cancelWatchdogs(): void {
    this._cancelConnectTimer();
    this._cancelSlowTimer();
  }
}
