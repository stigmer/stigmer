/**
 * Activity execution tracking for the cursor-runner.
 *
 * Tracks the number of concurrently executing Temporal activities and the
 * timestamp of the last activity event. The heartbeat client reads these
 * to report current_executions and determine the runner's phase.
 *
 * Previously this module also contained an idle self-termination watchdog
 * that would shut down the process after sustained inactivity. That
 * responsibility has moved to server-side idle aggregation across all
 * runner processes in the sandbox (see RunnerHeartbeatService).
 */

let lastActivityAt = Date.now();
let activeCount = 0;

/**
 * Record an activity starting. Resets the idle timer.
 */
export function activityStarted(): void {
  activeCount++;
  lastActivityAt = Date.now();
}

/**
 * Record an activity finishing. Resets the idle timer.
 */
export function activityFinished(): void {
  activeCount = Math.max(0, activeCount - 1);
  lastActivityAt = Date.now();
}

/**
 * Returns the number of currently in-flight activities.
 */
export function getActiveCount(): number {
  return activeCount;
}

/**
 * Returns the timestamp (ms since epoch) of the last activity event.
 */
export function getLastActivityAt(): number {
  return lastActivityAt;
}
