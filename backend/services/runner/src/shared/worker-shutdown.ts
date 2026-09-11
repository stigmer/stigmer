/**
 * Per-task-queue worker-shutdown signals — the classification channel that
 * lets an in-flight activity distinguish "my worker is shutting down" from
 * "the orchestrator cancelled me" (a user pause).
 *
 * The signal carries NO lifecycle authority: aborting it never stops a
 * worker or an activity (Temporal's own drain does that). It exists purely
 * so the activity's cancellation handling can classify the interruption
 * honestly — a shutdown is not a pause, and must surface as the
 * worker-shutdown failure shape the control planes recognize (issue #776).
 *
 * Ownership contract:
 *   - whoever creates a Worker registers a signal for its queue BEFORE the
 *     worker starts polling;
 *   - whoever initiates a full shutdown (SIGTERM handler, desktop quit)
 *     aborts the signal BEFORE calling worker.shutdown(), so activities
 *     cancelled by the drain observe it already aborted;
 *   - a graceful single-worker teardown (view close, deferred teardown in
 *     the runner-manager) must NOT abort — those paths only run once no
 *     activity is in flight, and aborting earlier is exactly the regression
 *     that killed running activities on a view close.
 *
 * Module-level (not per-manager) because activities resolve their signal by
 * task-queue name via {@link getShutdownSignalForQueue} without a handle to
 * the runner/manager instance that created their worker.
 */

const registry = new Map<string, AbortController>();

/**
 * Register a fresh shutdown signal for a task queue, replacing any previous
 * registration (a re-created worker on a reused queue must not observe the
 * old worker's aborted signal). Returns the controller so the worker's owner
 * can abort it at shutdown.
 */
export function registerWorkerShutdownSignal(taskQueue: string): AbortController {
  const controller = new AbortController();
  registry.set(taskQueue, controller);
  return controller;
}

/** The signal an activity on `taskQueue` should observe, if one is registered. */
export function getShutdownSignalForQueue(taskQueue: string): AbortSignal | undefined {
  return registry.get(taskQueue)?.signal;
}

/**
 * Abort the queue's signal, marking any in-flight activity's imminent
 * cancellation as a worker shutdown. Idempotent; no-op for an unknown queue.
 */
export function signalWorkerShutdown(taskQueue: string): void {
  registry.get(taskQueue)?.abort();
}

/** Drop the registration once the queue's worker is fully torn down. */
export function unregisterWorkerShutdownSignal(taskQueue: string): void {
  registry.delete(taskQueue);
}

/**
 * Why Temporal cancelled the activity, as the SDK states it: the message of
 * the `CancelledFailure` it aborted `Context.current().cancellationSignal`
 * with (`@temporalio/activity`'s module header lists them — `CANCELLED` for a
 * workflow-requested cancel, `TIMED_OUT` when a heartbeat or other timeout
 * fired server-side, `NOT_FOUND` when the run closed, `WORKER_SHUTDOWN`,
 * `HEARTBEAT_DETAILS_CONVERSION_FAILED`, `PAUSED`). `undefined` when no
 * cancellation was delivered.
 */
export type CancellationReason = string | undefined;

/** The reason a cancellation signal carries, or `undefined` when it has not aborted. */
export function cancellationReasonOf(signal: AbortSignal): CancellationReason {
  if (!signal.aborted) return undefined;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "CANCELLED";
}

/** The evidence a turn's interruption classification weighs (see below). */
export interface TurnInterruptionEvidence {
  /** The delivered cancellation's reason; `undefined` when none was delivered. */
  readonly cancellationReason: CancellationReason;
  /** This queue's worker-shutdown signal is aborted. */
  readonly shutdownSignalAborted: boolean;
}

/**
 * How Temporal's cancellation reads to the turn:
 *  - `worker-shutdown`: the runner is draining (the queue's signal, or the
 *    SDK's own `WORKER_SHUTDOWN`); FAILED with the shutdown copy, thrown.
 *  - `pause`: the workflow asked (`CANCELLED`, the Pause RPC's path);
 *    PAUSED, thrown.
 *  - `infrastructure`: the platform cancelled for its own reason (a heartbeat
 *    timeout, a closed run); FAILED with the unresponsive copy, thrown.
 *  - `none`: nothing was delivered.
 */
export type TurnInterruption = "worker-shutdown" | "pause" | "infrastructure" | "none";

/**
 * Classify how (whether) Temporal interrupted the turn, from the two live
 * facts: the reason on the cancellation signal and the queue's shutdown
 * signal. Pure so the decision table is directly testable.
 *
 * The load-bearing rule is the grace-window guard (#776): an aborted
 * shutdown signal ALONE is "none", because a run that completes normally
 * inside the drain grace window reaches the classification with the signal
 * already aborted and nothing actually interrupted. Shutdown requires a
 * delivered cancellation alongside the signal.
 *
 * Until S2 M3 the evidence also carried two flags from the periodic
 * heartbeat ("it threw `CancelledFailure`"), and a delivered cancellation
 * without them read as "none". `Context.heartbeat()` never throws in the
 * Temporal TypeScript SDK (it enqueues to the worker's heartbeat subject;
 * `@temporalio/activity/lib/index.js` `Context.heartbeat`,
 * `@temporalio/worker/lib/worker.js` the heartbeat callback), so the flags
 * were never set and a pause was in fact recognised by the stream loop's
 * own cancellation check. The reason the SDK puts on the signal is the
 * direct identity that inference stood in for.
 */
export function classifyTurnInterruption(evidence: TurnInterruptionEvidence): TurnInterruption {
  const { cancellationReason, shutdownSignalAborted } = evidence;
  if (cancellationReason === undefined) {
    return "none";
  }
  if (shutdownSignalAborted || cancellationReason === "WORKER_SHUTDOWN") {
    return "worker-shutdown";
  }
  return cancellationReason === "CANCELLED" ? "pause" : "infrastructure";
}
