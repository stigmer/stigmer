/**
 * Per-task-queue worker-shutdown signals — the channel that tells an
 * in-flight activity "my worker is draining", apart from "the orchestrator
 * cancelled me" (a user's Pause or Cancel).
 *
 * The signal carries NO lifecycle authority over the worker: aborting it
 * never stops a worker (Temporal's own drain does that). An activity reads
 * it two ways. The turn runtime asks its engine to yield at the next durable
 * step boundary the moment it aborts, so the running step finishes inside
 * the worker's drain grace and the next runner continues the turn
 * (`harness/run-turn.ts`, stigmer#2428). And the cancellation handling
 * classifies a cancellation that arrives with it as a worker shutdown, not
 * a user's stop (issue #776).
 *
 * Each queue has a second signal, "stop now": the owner aborts it when it is
 * told to shut down a second time (a second SIGTERM), and every turn on the
 * queue stops at once instead of waiting for its boundary; the turn still
 * continues on the next runner.
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

/** One queue's two signals: the drain, and the second signal's "stop now". */
interface QueueSignals {
  readonly drain: AbortController;
  readonly now: AbortController;
}

const registry = new Map<string, QueueSignals>();

/**
 * Register fresh signals for a task queue, replacing any previous
 * registration (a re-created worker on a reused queue must not observe the
 * old worker's aborted signal). Returns the drain's controller so the
 * worker's owner can abort it at shutdown.
 */
export function registerWorkerShutdownSignal(taskQueue: string): AbortController {
  const signals: QueueSignals = { drain: new AbortController(), now: new AbortController() };
  registry.set(taskQueue, signals);
  return signals.drain;
}

/** The drain signal an activity on `taskQueue` should observe, if one is registered. */
export function getShutdownSignalForQueue(taskQueue: string): AbortSignal | undefined {
  return registry.get(taskQueue)?.drain.signal;
}

/** The "stop now" signal an activity on `taskQueue` should observe, if one is registered. */
export function getStopNowSignalForQueue(taskQueue: string): AbortSignal | undefined {
  return registry.get(taskQueue)?.now.signal;
}

/**
 * Abort the queue's drain signal: every in-flight turn yields at its next
 * step boundary, and a cancellation that follows reads as a worker
 * shutdown. Idempotent; no-op for an unknown queue.
 */
export function signalWorkerShutdown(taskQueue: string): void {
  registry.get(taskQueue)?.drain.abort();
}

/**
 * Abort the queue's "stop now" signal (and its drain, which it implies):
 * every in-flight turn stops at once, to continue on the next runner.
 * Idempotent; no-op for an unknown queue.
 */
export function signalWorkerStopNow(taskQueue: string): void {
  const signals = registry.get(taskQueue);
  signals?.drain.abort();
  signals?.now.abort();
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
 *  - `worker-shutdown`: the runner drained past its grace (the queue's
 *    signal, or the SDK's own `WORKER_SHUTDOWN`); nothing terminal is
 *    written and the turn continues on the next runner, thrown.
 *  - `orchestrator-stop`: the workflow asked (`CANCELLED`). That is a Pause
 *    or a Cancel, and the turn cannot tell which: both reach the activity
 *    as the same workflow-requested cancellation, and both RPCs signal the
 *    engine before they persist the phase, so no stored fact tells them
 *    apart in time. The turn settles its transcript with no phase and no
 *    row, thrown; the workflow, which knows which stop it runs, writes the
 *    phase and the stop row (stigmer#980).
 *  - `infrastructure`: the platform cancelled for its own reason (a heartbeat
 *    timeout, a closed run); nothing terminal is written, thrown.
 *  - `none`: nothing was delivered.
 */
export type TurnInterruption = "worker-shutdown" | "orchestrator-stop" | "infrastructure" | "none";

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
 * Until #1070 the evidence also carried two flags from the periodic
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
  return cancellationReason === "CANCELLED" ? "orchestrator-stop" : "infrastructure";
}
