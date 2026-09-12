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
 * function"). Until S2 M3 this handle carried two flags for a throw that
 * cannot happen; a turn reads its interruption from the signal's reason
 * instead (`worker-shutdown.ts` `classifyTurnInterruption`).
 */

import { Context, CancelledFailure } from "@temporalio/activity";

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
