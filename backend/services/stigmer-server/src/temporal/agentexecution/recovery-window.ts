/**
 * The sliding window a run's recoveries are counted in (the invoke
 * workflow's bounded recovery loop).
 *
 * Why a window and not a count over the run's life: a turn that runs for
 * hours meets a deploy or a lost runner every so often, and each one is a
 * recovery. Ten of them inside an hour is a loop that will not settle, and
 * fails the run as before; ten spread over three hours is a long turn
 * working, which no fixed count over its life should end.
 *
 * Pure and dependency-free: the workflow bundle imports it (the module
 * header of `workflows/invoke-agent-execution.ts` lists what may be).
 */

/** How far back a recovery still counts. */
export const RECOVERY_WINDOW_MS = 60 * 60_000;

/**
 * Record a recovery at `now` in `instants` (oldest first, mutated) and
 * return how many fall within {@link RECOVERY_WINDOW_MS} of it, this one
 * included.
 */
export function countRecovery(instants: number[], now: number): number {
  instants.push(now);
  while (instants.length > 0 && now - instants[0]! > RECOVERY_WINDOW_MS) {
    instants.shift();
  }
  return instants.length;
}
