/**
 * Activity execution tracking for the unified runner.
 *
 * Tracks the number of concurrently executing Temporal activities and the
 * timestamp of the last activity event. The heartbeat client reads these
 * to report current_executions and determine the runner's phase (READY/BUSY).
 */

let lastActivityAt = Date.now();
let activeCount = 0;

export function activityStarted(): void {
  activeCount++;
  lastActivityAt = Date.now();
}

export function activityFinished(): void {
  activeCount = Math.max(0, activeCount - 1);
  lastActivityAt = Date.now();
}

export function getActiveCount(): number {
  return activeCount;
}

export function getLastActivityAt(): number {
  return lastActivityAt;
}
