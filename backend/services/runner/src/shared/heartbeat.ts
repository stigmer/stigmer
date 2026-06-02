/**
 * Activity heartbeat utility.
 *
 * Provides a periodic heartbeat loop that activities can start for
 * long-running operations. The loop sends heartbeat details at a
 * configurable interval and stops when cancelled or when the
 * returned abort function is called.
 *
 * Heartbeats serve two purposes:
 * 1. Prevent Temporal from timing out the activity (heartbeatTimeout)
 * 2. Detect parent workflow cancellation (CancelledFailure from heartbeat)
 */

import { Context, CancelledFailure } from "@temporalio/activity";

export interface HeartbeatHandle {
  stop(): void;
  readonly cancelled: boolean;
  readonly workerShutdown: boolean;
}

export interface HeartbeatOptions {
  shutdownSignal?: AbortSignal;
}

export function startHeartbeat(
  intervalMs: number,
  getDetails?: () => Record<string, unknown>,
  options?: HeartbeatOptions,
): HeartbeatHandle {
  let stopped = false;
  let wasCancelled = false;
  let wasWorkerShutdown = false;

  const timer = setInterval(() => {
    if (stopped) return;
    try {
      Context.current().heartbeat(getDetails?.());
    } catch (err) {
      if (err instanceof CancelledFailure) {
        if (options?.shutdownSignal?.aborted) {
          wasWorkerShutdown = true;
        } else {
          wasCancelled = true;
        }
        stopped = true;
        clearInterval(timer);
      }
    }
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    get cancelled() {
      return wasCancelled;
    },
    get workerShutdown() {
      return wasWorkerShutdown;
    },
  };
}

export function checkCancellation(): void {
  if (Context.current().cancellationSignal.aborted) {
    throw new CancelledFailure("Activity cancelled by workflow");
  }
}
