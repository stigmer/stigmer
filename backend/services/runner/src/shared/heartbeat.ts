/**
 * Activity heartbeat utility.
 *
 * Provides a periodic heartbeat loop that activities can start for
 * long-running operations. The loop sends heartbeat details at a
 * configurable interval and stops when the returned handle is stopped.
 *
 * Heartbeats keep Temporal from timing the activity out
 * (`heartbeatTimeout`) and are how an activity RECEIVES cancellation: the
 * server piggybacks a cancel request on a heartbeat response, and the SDK
 * then aborts `Context.current().cancellationSignal`. `Context.heartbeat()`
 * itself never throws for cancellation (it enqueues to the worker's
 * heartbeat subject — `@temporalio/activity/lib/index.js`
 * `Context.heartbeat`, `@temporalio/worker/lib/worker.js` the heartbeat
 * callback; the SDK's own doc: "Cancellation is not propagated from this
 * function"). Until #1070 this handle carried two flags for a throw that
 * cannot happen; a turn reads its interruption from the signal's reason
 * instead (`worker-shutdown.ts` `classifyTurnInterruption`).
 *
 * So two knobs bound how soon a pause, cancel or interrupt reaches a running
 * turn, and both take {@link CANCELLATION_PULSE_MS}: how often a quiet turn
 * heartbeats (`harness/run-turn.ts`, the only heartbeat a turn waiting on a
 * silent model call or a long tool sends), and how long the worker may hold
 * a heartbeat back before sending it ({@link heartbeatWorkerOptions}; the
 * SDK's default holds one for up to a minute, the stop stigmer#1378 measured).
 */

import { Context, CancelledFailure } from "@temporalio/activity";
import type { WorkerOptions } from "@temporalio/worker";

/**
 * How long a pause, cancel or interrupt takes, at most, to reach a running
 * turn: the turn's heartbeat interval and the worker's heartbeat throttle.
 * A heartbeat is a local enqueue; the worker sends at most one per activity
 * in this window.
 */
export const CANCELLATION_PULSE_MS = 3_000;

/**
 * The heartbeat options every runner worker is created with (`worker.ts`,
 * `runner-manager.ts`), so a turn on the static worker and one on a session's
 * worker hear a cancellation alike.
 */
export const heartbeatWorkerOptions = {
  maxHeartbeatThrottleInterval: CANCELLATION_PULSE_MS,
} as const satisfies Pick<WorkerOptions, "maxHeartbeatThrottleInterval">;

export interface HeartbeatHandle {
  stop(): void;
}

export function startHeartbeat(
  intervalMs: number,
  getDetails?: () => Record<string, unknown>,
): HeartbeatHandle {
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    Context.current().heartbeat(getDetails?.());
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export function checkCancellation(): void {
  if (Context.current().cancellationSignal.aborted) {
    throw new CancelledFailure("Activity cancelled by workflow");
  }
}
