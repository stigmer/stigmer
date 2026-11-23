/**
 * The pure parts of a shared turn's wait for a place, shared by the
 * agent-execution workflow, its AdmitSharedTurn and ReleaseSharedTurn
 * activities and the engine client.
 *
 * A turn a shared runner serves (domain/run/placement.ts `shared`) needs no
 * sandbox, but a composition may still bound how many such turns of one
 * organization run at once (extensions: `sharedTurnAdmission`). The
 * workflow asks for a place before the turn's first runner invocation and
 * before every one after it (after an approval, a resume, a recovery),
 * exactly where a sandboxed turn asks for its sandbox, and waits on "no
 * room" with the same loop and limit (sandbox-wait.ts). The wait happens
 * here, in the workflow, so a runner activity's schedule-to-start window
 * never has to cover it.
 *
 * A turn holds a place only while it runs: the workflow releases it when
 * the turn parks on a person's answer or a pause (and asks again when it
 * carries on), and when the workflow ends, however it ends, before the
 * session's queued turn starts. A server with no admission composed
 * answers `unbounded`: the turn goes on, and nothing is released.
 *
 * The words differ from a sandbox's (no sandbox is involved); the stop's
 * kind is the sandbox wait's (`no_sandbox_room`), so every client already
 * reads the ending as "there was no room, nothing was lost".
 *
 * WORKFLOW-BUNDLE SAFE: imported by the workflow, so nothing here imports a
 * node built-in or a host module.
 */

/**
 * What one ask for a place came to: `ready` (a place is held until it is
 * released), `no_room` (wait and ask again), `unbounded` (nothing bounds
 * shared turns here: go on, release nothing), or `failed` (the ask failed
 * after its retries: logged, and the turn goes on, as a failed sandbox
 * ensure does). Wire words: the AdmitSharedTurn activity returns them.
 */
export type SharedTurnAdmissionOutcome = "ready" | "no_room" | "unbounded" | "failed";

/** The AdmitSharedTurn and ReleaseSharedTurn activities' input. snake_case, as every payload this workflow schedules. */
export interface SharedTurnInput {
  readonly execution_id: string;
  /** The class of the caller whose request started the run (CallerIdentity.callerClass). */
  readonly caller_class: string;
  /** When the turn's wait for a place began (workflow time, epoch ms), absent on the first ask. */
  readonly waiting_since_ms?: number;
}

/** The run's phase text while a shared turn waits for a place. */
export const SHARED_WAITING_PHASE_TEXT = "Waiting for room to run";

/**
 * The person's sentence for a shared turn whose wait ran out
 * (status.error): that every place was taken, that nothing was lost, and
 * what running it again does.
 */
export function sharedWaitRanOutCopy(limitSeconds: number): string {
  if (limitSeconds <= 0) {
    return "Your organization was already running as many agents as it may at once, so this turn didn't start. Nothing was lost: run it again once one finishes.";
  }
  return `Your organization was running as many agents as it may at once for ${waitLength(limitSeconds)}, so this turn didn't start. Nothing was lost: run it again to wait for room.`;
}

/** "45 seconds", "1 minute", "15 minutes": whole minutes from a minute on, floored (sandbox-wait.ts's rule). */
function waitLength(seconds: number): string {
  if (seconds < 60) {
    return seconds === 1 ? "1 second" : `${seconds} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
