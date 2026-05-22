/**
 * Activity execution tracking for the execution worker.
 *
 * Tracks the number of concurrently executing Temporal activities and the
 * timestamp of the last activity event. Used by activities for diagnostics
 * and concurrency-aware behavior.
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
