/**
 * Per-task-queue in-flight activity tracking.
 *
 * A session/wfexec worker must NOT be torn down while one of its activities
 * (notably the long-running ExecuteCursor) is still running: doing so abandons
 * the activity and removes the only poller on its queue, turning a harmless UI
 * navigation into an "Activity task timed out" dead-end. The activity inbound
 * interceptor increments on every activity start and decrements on finish;
 * runner-manager's removeSession/removeWorkflowExecution consult the count and
 * defer teardown until it drains.
 *
 * This lives in its own module (rather than inside the runner-manager closure)
 * so the interceptor — which has no handle to that closure — and unit tests can
 * both reach it. Keyed by task queue (`session:{id}` / `wfexec:{id}`), it is
 * process-global, mirroring the shutdown-signal registry.
 */

interface InFlightEntry {
  count: number;
  /** Invoked once when count returns to 0; used to run a deferred teardown. */
  onDrained?: () => void;
}

const registry = new Map<string, InFlightEntry>();

/** Record that an activity started on the given task queue. */
export function activityStartedOnQueue(taskQueue: string): void {
  const entry = registry.get(taskQueue) ?? { count: 0 };
  entry.count++;
  registry.set(taskQueue, entry);
}

/**
 * Record that an activity finished on the given task queue. When the count
 * returns to zero, any registered drain callback fires exactly once.
 */
export function activityFinishedOnQueue(taskQueue: string): void {
  const entry = registry.get(taskQueue);
  if (!entry) return;
  entry.count = Math.max(0, entry.count - 1);
  if (entry.count === 0 && entry.onDrained) {
    const onDrained = entry.onDrained;
    entry.onDrained = undefined;
    onDrained();
  }
}

/** Current number of in-flight activities on the task queue (0 if unknown). */
export function inFlightCountForQueue(taskQueue: string): number {
  return registry.get(taskQueue)?.count ?? 0;
}

/**
 * Register (or clear) a callback to run when the queue next drains to zero
 * in-flight activities. No-op if the queue has no entry (count already 0); the
 * caller handles the already-idle case by tearing down immediately.
 */
export function setQueueDrainCallback(taskQueue: string, cb: (() => void) | undefined): void {
  const entry = registry.get(taskQueue);
  if (entry) entry.onDrained = cb;
}

/** Forget all tracking for a queue (called after its worker is torn down). */
export function forgetQueue(taskQueue: string): void {
  registry.delete(taskQueue);
}

/** Test-only: clear the entire registry between cases. */
export function __resetInFlightRegistryForTests(): void {
  registry.clear();
}
