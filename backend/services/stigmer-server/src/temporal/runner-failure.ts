/**
 * Runner-failure classification at the polyglot Temporal boundary — ports
 * pkg/runnerfailure (issue #776).
 *
 * "The runner's worker was shut down mid-activity" has no typed
 * representation across the Temporal boundary; it arrives as one of two
 * message shapes:
 *
 *   1. the activity's OWN classification, thrown as a cancelled failure
 *      ("Activity cancelled (worker shutdown, not user pause)" — the
 *      runner's execute-cursor/execute-deep-agent shutdown branches); and
 *   2. the Temporal TS worker's drain failing an activity that could not
 *      finish inside the shutdown grace window ("Worker is shutting down
 *      and this activity did not complete in time") — the shape observed
 *      live in the 2026-08-08 incident.
 *
 * Both mean the same thing: infrastructure interrupted the turn; the user
 * did nothing. Recognizing them in ONE place keeps two behaviors
 * consistent across the agentexecution (#18) and workflowexecution (#21)
 * workflows: status.error carries the honest platform-failure copy
 * instead of raw Temporal internals, and the interruption is treated as
 * recoverable by the bounded recovery loop (owner ruling on #776).
 *
 * Cancelled failures are matched loosely (their messages are
 * runner-authored, never agent/tool output); everything else must carry
 * the distinctive drain phrase. Deliberately the same shapes the Go and
 * Java control planes match.
 *
 * Bundle-safe: only @temporalio/common failure classes (workflow-sandbox
 * legal), imported by workflow code.
 */
import { CancelledFailure, ApplicationFailure } from "@temporalio/common";

/**
 * The honest status.error copy for a worker-shutdown-interrupted turn.
 * Byte-identical to the copy the runner persists from its own shutdown
 * branches and to the Go/Java mapping, so every downstream status.error
 * consumer keys on one string (Go runnerfailure.WorkerShutdownStatusError).
 */
export const WORKER_SHUTDOWN_STATUS_ERROR =
  "Execution interrupted: runner worker was shut down. Retry or resume.";

const CANCELED_MARKERS = ["worker shutdown", "shutting down"];

const DRAIN_MARKER = "worker is shutting down";

/**
 * Whether err (anywhere in its cause chain) carries a runner
 * worker-shutdown shape (Go runnerfailure.IsWorkerShutdown).
 */
export function isWorkerShutdown(err: unknown): boolean {
  for (
    let e: unknown = err;
    e instanceof Error;
    e = (e as { cause?: unknown }).cause
  ) {
    const lower = e.message.toLowerCase();
    if (e instanceof CancelledFailure) {
      if (CANCELED_MARKERS.some((marker) => lower.includes(marker))) {
        return true;
      }
    } else if (e instanceof ApplicationFailure) {
      if (lower.includes(DRAIN_MARKER)) {
        return true;
      }
    } else if (lower.includes(DRAIN_MARKER)) {
      return true;
    }
  }
  return false;
}
