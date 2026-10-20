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
 * consistent in the agentexecution workflow:
 * status.error carries the honest platform-failure copy
 * instead of raw Temporal internals, and the interruption is treated as
 * recoverable by the bounded recovery loop (owner ruling on #776).
 *
 * Cancelled failures are matched loosely (their messages are
 * runner-authored, never agent/tool output); everything else must carry
 * the distinctive drain phrase. Deliberately the same shapes the Go and
 * Java control planes match.
 *
 * A turn can also stop on its own so that the workflow continues it: a
 * draining runner's engine yields at its next durable step boundary
 * (stigmer#2428). No cancellation was delivered then, so the runner throws a
 * typed `ApplicationFailure` whose type is {@link TURN_CONTINUES_FAILURE_TYPE}
 * and whose one detail names the cause. It is matched by that type, never
 * by its message.
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

/**
 * The failure type a runner's continuing turn throws (the runner's
 * `harness/terminal-table.ts` `TURN_CONTINUES_FAILURE_TYPE`). Wire
 * vocabulary: byte-pinned on both sides.
 */
export const TURN_CONTINUES_FAILURE_TYPE = "StigmerTurnContinues";

/**
 * Why a runner's turn stopped to continue: its runner drained, or its model
 * stopped answering (a stall the provider owed, which the runner continues
 * instead of failing).
 */
export type TurnContinuationCause = "drain" | "model-stall";

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

/**
 * The cause a runner named when its turn stopped to continue (anywhere in
 * the cause chain), or `undefined` when `err` is no such failure. A cause
 * this server does not know (a newer runner's) still reads as a
 * continuation, as its string. The other skew, a runner that throws this
 * failure to a server that predates it, ends the drained turn FAILED with
 * the failure's message, as a drain did before: so the server is upgraded
 * no later than its runners (a desktop or self-hosted runner can be newer).
 */
export function turnContinuationCauseOf(err: unknown): TurnContinuationCause | string | undefined {
  for (
    let e: unknown = err;
    e instanceof Error;
    e = (e as { cause?: unknown }).cause
  ) {
    if (e instanceof ApplicationFailure && e.type === TURN_CONTINUES_FAILURE_TYPE) {
      const cause: unknown = e.details?.[0];
      return typeof cause === "string" ? cause : "";
    }
  }
  return undefined;
}

/**
 * The copy a model stall's continuation carries, which is the run's error
 * when the workflow gives up continuing it: the runner's own stall copy,
 * the typed failure's message. `undefined` for any other failure.
 */
export function modelStallCopyOf(err: unknown): string | undefined {
  for (
    let e: unknown = err;
    e instanceof Error;
    e = (e as { cause?: unknown }).cause
  ) {
    if (e instanceof ApplicationFailure && e.type === TURN_CONTINUES_FAILURE_TYPE) {
      return e.details?.[0] === "model-stall" ? e.message : undefined;
    }
  }
  return undefined;
}

/** Whether `err` is a runner's turn that stopped so the workflow continues it. */
export function isTurnContinuation(err: unknown): boolean {
  return turnContinuationCauseOf(err) !== undefined;
}

/**
 * Whether a run the workflow gave up recovering ends with the worker
 * shutdown's copy and the `infrastructure` cause: a runner drained mid-turn,
 * in either shape (its worker stopped the turn, or the turn yielded to
 * continue). The runner writes no ending for either (stigmer#2428), so the
 * workflow's FAILED is the run's last word.
 */
export function endsAsWorkerShutdown(err: unknown): boolean {
  return isWorkerShutdown(err) || turnContinuationCauseOf(err) === "drain";
}
