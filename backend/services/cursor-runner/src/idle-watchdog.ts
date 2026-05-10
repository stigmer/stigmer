/**
 * Idle self-termination watchdog for ephemeral runners.
 *
 * Monitors activity execution frequency and initiates graceful shutdown
 * via worker.shutdown() when no Temporal activities have run for a
 * configurable period. Mirrors the Python agent-runner's IdleWatchdog
 * pattern.
 *
 * The watchdog is opt-in: disabled when STIGMER_IDLE_TIMEOUT_SECONDS is
 * absent or zero. The launcher passes this env var for ephemeral
 * (cloud-provisioned) runners; persistent and local runners never set it.
 */

import type { Worker } from "@temporalio/worker";

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
 * Start the idle watchdog. Checks every `checkIntervalMs` whether the
 * runner has been idle for longer than `timeoutSeconds`. If so, initiates
 * graceful shutdown.
 *
 * Returns a cleanup function that stops the watchdog.
 */
export function startIdleWatchdog(
  worker: Worker,
  timeoutSeconds: number,
  checkIntervalMs = 30_000,
): () => void {
  console.log(
    `Idle watchdog started (timeout=${timeoutSeconds}s, check_interval=${checkIntervalMs / 1000}s)`,
  );

  const handle = setInterval(() => {
    if (activeCount > 0) {
      return;
    }

    const idleMs = Date.now() - lastActivityAt;
    if (idleMs < timeoutSeconds * 1000) {
      return;
    }

    const idleSec = Math.round(idleMs / 1000);
    console.log(
      `Runner idle for ${idleSec}s (threshold ${timeoutSeconds}s) — initiating graceful shutdown`,
    );

    clearInterval(handle);
    worker.shutdown();
  }, checkIntervalMs);

  return () => clearInterval(handle);
}
