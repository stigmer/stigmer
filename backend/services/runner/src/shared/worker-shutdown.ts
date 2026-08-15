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

/** The evidence a turn's post-stream classification weighs (see below). */
export interface TurnInterruptionEvidence {
  /** The periodic heartbeat threw CancelledFailure with no shutdown signal. */
  heartbeatCancelled: boolean;
  /** The periodic heartbeat threw CancelledFailure with the signal aborted. */
  heartbeatWorkerShutdown: boolean;
  /** Temporal delivered cancellation to the activity. */
  cancellationSignalAborted: boolean;
  /** This queue's worker-shutdown signal is aborted. */
  shutdownSignalAborted: boolean;
}

/**
 * Classify how (whether) a turn's stream was interrupted, from the evidence
 * available after the stream ends. Pure so the decision table is directly
 * testable — the activities feed it their heartbeat flags and signals.
 *
 * The load-bearing rule is the grace-window guard (#776): an aborted
 * shutdown signal ALONE is "none", because a run that completes normally
 * inside the drain grace window reaches the classification with the signal
 * already aborted and nothing actually interrupted. Shutdown requires
 * interruption evidence (a heartbeat CancelledFailure or a delivered
 * cancellation) alongside the signal; a heartbeat cancellation with no
 * shutdown signal is the orchestrator's pause.
 */
export function classifyTurnInterruption(
  evidence: TurnInterruptionEvidence,
): "worker-shutdown" | "pause" | "none" {
  const interrupted =
    evidence.heartbeatCancelled ||
    evidence.heartbeatWorkerShutdown ||
    evidence.cancellationSignalAborted;
  if (!interrupted) {
    return "none";
  }
  if (evidence.heartbeatWorkerShutdown || evidence.shutdownSignalAborted) {
    return "worker-shutdown";
  }
  return evidence.heartbeatCancelled ? "pause" : "none";
}
