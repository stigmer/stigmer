// The session follow's lifecycle, framework-agnostic: which stage it is in
// (idle, connecting, streaming, reconnecting, error), when to publish the
// folded log (frames are folded as they arrive and published at most once
// per animation frame), and two watchdogs: a hard connect-timeout while no
// frame has arrived, and a soft slow-stall hint after a quiet stretch.
// `useSessionEvents` hosts it; the store it writes through is a sink.

import type { StreamSessionEventsResponse } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { StreamState } from "./store/conversation-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const IDLE: StreamState = { stage: "idle" };

/**
 * Hard connect-timeout: how long a follow may stay `connecting` (no frame)
 * before the watchdog acts. A healthy follow replays the stored log at once,
 * so a silent stretch this long is a stalled connection.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/**
 * Soft slow-stall threshold: a follow that delivers nothing for this long
 * flips an informational "still working" hint. Long enough that ordinary
 * model thinking-time never trips it.
 */
export const DEFAULT_SLOW_THRESHOLD_MS = 60_000;

/**
 * How the controller reaches its host (the hook and its store). Every
 * outward effect goes through these callbacks.
 */
export interface StreamControllerSink {
  /** Fold one frame into the log; returns whether the fold changed. */
  applyFrame(frame: StreamSessionEventsResponse): boolean;
  /** Publish the log's current fold. */
  publish(): void;
  /** Transition the follow's lifecycle stage. */
  setStreamState(state: StreamState): void;
  /**
   * The hard connect-timeout elapsed while still `connecting`. The host owns
   * the reconnect-once-then-surface policy: it holds the reconnect counter
   * and the guard that must survive the reconnect, which the controller
   * (reset on every teardown) cannot.
   */
  onConnectTimeout(): void;
  /** Set or clear the soft slow-stall hint. */
  setSlow(value: boolean): void;
}

/**
 * Injectable watchdog configuration. Timers default to `setTimeout` /
 * `clearTimeout`; tests pass fakes so the watchdog runs without real time.
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
 * The state machine of one session follow.
 *
 * - `start` enters `connecting` and arms both watchdogs.
 * - `handleFrame` folds the frame through the sink at once and schedules one
 *   publish for the next animation frame, so a replay of a long log or a
 *   burst of token previews commits once per frame. The first frame moves
 *   `connecting` (or `reconnecting`) to `streaming`.
 * - `handleReconnecting` enters `reconnecting` (the last fold stays visible).
 * - `handleError` publishes what was folded and enters `error`.
 * - `reset` cancels everything and returns to `idle`.
 *
 * No React dependency; `scheduleFlush` is typically `requestAnimationFrame`.
 */
export class StreamController {
  private _state: StreamState = IDLE;
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

  /** Current stage (read-only). */
  get state(): StreamState {
    return this._state;
  }

  /** Enter `connecting` for a session, arming both watchdogs. */
  start(sessionId: string): void {
    this._cancelPendingFlush();
    this._armConnectTimer();
    this._armSlowTimer();
    this._transition({ stage: "connecting", sessionId });
  }

  /**
   * Fold one frame and schedule its publish. Any frame proves the
   * connection healthy: the connect watchdog stands down and the slow window
   * restarts.
   */
  handleFrame(frame: StreamSessionEventsResponse): void {
    const sessionId = this._activeSessionId();
    if (!sessionId) return;
    this._cancelConnectTimer();
    this._armSlowTimer();
    if (this._state.stage !== "streaming") {
      this._transition({ stage: "streaming", sessionId });
    }
    if (this._sink.applyFrame(frame)) {
      this._scheduleFlushOnce();
    }
  }

  /**
   * Enter `reconnecting` after the stream dropped. The watchdogs stand down
   * (the reconnect is its own visible affordance) and the slow hint clears,
   * so "reconnecting" and "slow" never show at once.
   */
  handleReconnecting(attempt: number): void {
    const sessionId = this._activeSessionId();
    if (!sessionId) return;
    this._cancelWatchdogs();
    this._sink.setSlow(false);
    this._transition({ stage: "reconnecting", sessionId, attempt });
  }

  /**
   * The follow was refused and ended. What was folded is published first,
   * so the last known conversation stays beside the error.
   */
  handleError(error: Error): void {
    const sessionId = this._activeSessionId();
    if (!sessionId) return;
    this._cancelWatchdogs();
    this._sink.setSlow(false);
    this._cancelPendingFlush();
    this._sink.publish();
    this._transition({ stage: "error", sessionId, error });
  }

  /** Return to idle, cancelling any pending publish and the watchdogs. */
  reset(): void {
    this._cancelWatchdogs();
    this._sink.setSlow(false);
    this._cancelPendingFlush();
    if (this._state.stage !== "idle") {
      this._transition(IDLE);
    }
  }

  /** Whether a publish is scheduled. */
  get hasPendingFlush(): boolean {
    return this._rafId !== null;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _activeSessionId(): string | null {
    if (this._state.stage === "idle") return null;
    return this._state.sessionId;
  }

  private _transition(next: StreamState): void {
    this._state = next;
    this._sink.setStreamState(next);
  }

  private _scheduleFlushOnce(): void {
    if (this._rafId !== null) return;
    this._rafId = this._scheduleFlush(() => {
      this._rafId = null;
      this._sink.publish();
    });
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
      if (this._state.stage !== "connecting") return;
      this._sink.onConnectTimeout();
    }, this._connectTimeoutMs);
  }

  private _armSlowTimer(): void {
    this._cancelSlowTimer();
    // Re-arming means activity just resumed (or is starting): a prior slow
    // hint no longer holds.
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
