/**
 * The pure parts of a turn's wait for a sandbox with room, shared by the
 * agent-execution workflow, its EnsureSessionSandbox activity and the
 * engine client that sets the wait's limit.
 *
 * A turn whose conversation runs in a provisioned sandbox (target CLOUD)
 * asks for its sandbox before its first runner activity, and again before
 * every runner invocation after it: after an approval, after a resume, and
 * before a recovery attempt. A turn parked on a person's answer or a pause
 * is not busy for the idle sweep (domain/run/phases.ts,
 * `keepsSandboxAwake`), so its sandbox may have gone to sleep while it
 * waited, and only an ask wakes it (stigmer#3122). When the sandbox
 * fleet answers "no room" (sandbox/provisioner.ts, SandboxNoRoomError), the
 * workflow asks again, `sandboxWaitBackoffMs` apart, until room comes or
 * the server's limit (`STIGMER_SANDBOX_WAIT_SECONDS`, carried in the
 * workflow input) runs out. The run reads RUN_PENDING with
 * `SANDBOX_WAITING_PHASE_TEXT` meanwhile, and a wait that runs out ends the
 * run with the `no_sandbox_room` kind and `sandboxWaitRanOutCopy`.
 *
 * Trade-offs:
 * - No order among waiting turns: whoever asks first after room appears
 *   gets it. The backoff's 15 s cap bounds how long a turn that lost a race
 *   waits for the next one, and Stigmer keeps no queue of the fleet's
 *   placements and no fleet number.
 * - The limit rides each turn's input, so its history records the limit it
 *   waited under, and a changed setting never changes a turn already
 *   waiting.
 * - The words are a person's (status.error is printed by the CLI and the
 *   phase text read by every client of the Run); a client that knows the
 *   kind words the ending itself.
 *
 * A sandbox started under another configuration whose files cannot be
 * carried to this server's runner (sandbox/provisioner.ts,
 * SandboxNotCarriedError; stigmer#1843) answers `not_carried`, and the
 * turn ends at once, before any runner work, with
 * `SANDBOX_NOT_CARRIED_COPY` under stop cause `failed` and kind
 * `internal`, the platform's fault: no new kind for an ending this rare.
 * Behind its own `patched()` id: an activity worker of a newer release
 * may answer `not_carried` to a workflow that went on to the runner
 * before the end existed, and that history must replay as recorded.
 *
 * A sandbox killed for exceeding its memory limit (sandbox/provisioner.ts,
 * SandboxOutOfMemoryError; stigmer#3347) answers `out_of_memory`: the
 * driver has reverted it to its last saved state and left it asleep. A
 * killed runner stops heartbeating, so the turn learns of the kill at its
 * heartbeat timeout, and its recovery's ask meets the answer. Without an
 * end, that recovery runs the same command again and the sandbox is killed
 * again, each time losing the files written since the last save. So:
 *   - an ask after the turn's first (after a recovery, a resume or an
 *     approval) ends the turn with `SANDBOX_OUT_OF_MEMORY_COPY` under stop
 *     cause `failed` and kind `sandbox_out_of_memory`: the kill came while
 *     the turn was alive, and running the command again would fail the
 *     same way. Its own kind, because the console words an ending by kind
 *     and `internal` would tell the person it wasn't their command.
 *   - the turn's first ask, before any runner work, means the kill came
 *     before this turn (an earlier turn, or a process it left running): it
 *     asks once more, which wakes the sandbox, and goes on. A second
 *     `out_of_memory` there is a fresh kill at the wake and ends the turn.
 * One `patched()` id covers both, for the same reason as `not_carried`'s.
 *
 * WORKFLOW-BUNDLE SAFE: imported by the workflow, so nothing here imports a
 * node built-in or a host module.
 *
 * Pinned by __tests__/sandbox-wait.test.ts and, in the workflow, by
 * invoke-workflow.temporal.test.ts and the sandbox-waited,
 * sandbox-not-carried, sandbox-not-carried-went-on, sandbox-out-of-memory,
 * sandbox-out-of-memory-asked-again and sandbox-out-of-memory-went-on replay
 * histories.
 */

/**
 * The `patched()` id that gates the wait in the workflow. Wire constant: a
 * history that took the patched path records it.
 */
export const SANDBOX_WAIT_PATCH_ID = "ensure-sandbox-in-workflow";

/**
 * The `patched()` id that gates the ask before every runner invocation
 * after a turn's first (module header). Wire constant: a history that took
 * the patched path records it.
 */
export const SANDBOX_REENSURE_PATCH_ID = "ensure-sandbox-on-resume";

/**
 * The `patched()` id that gates ending the turn on `not_carried` (module
 * header). Wire constant: a history that took the patched path records it.
 */
export const SANDBOX_NOT_CARRIED_PATCH_ID = "end-turn-on-sandbox-not-carried";

/**
 * The person's sentence for a turn whose sandbox could not be carried to
 * this server's runner (status.error): what happened and what to do.
 */
export const SANDBOX_NOT_CARRIED_COPY =
  "This conversation's sandbox was started by another Stigmer release and its files can't be moved to this one. Start a new conversation to continue.";

/**
 * The `patched()` id that gates ending the turn on `out_of_memory`, and the
 * first ask's one ask again (module header). Wire constant: a history that
 * took the patched path records it.
 */
export const SANDBOX_OUT_OF_MEMORY_PATCH_ID =
  "end-turn-on-sandbox-out-of-memory";

/**
 * The person's sentence for a turn whose sandbox ran out of memory
 * (status.error, printed by the CLI): what happened, why, and what it means
 * for their files.
 */
export const SANDBOX_OUT_OF_MEMORY_COPY =
  "The sandbox ran out of memory, so this turn stopped. A command needed more memory than this sandbox has. Its files went back to their last saved state, so recent changes may be gone.";

/** The stop kind of a turn whose sandbox ran out of memory (`StigmerStopDetail.kind`, under `failed`). */
export const SANDBOX_OUT_OF_MEMORY_STOP_KIND = "sandbox_out_of_memory";

/** The stop cause an out-of-memory ending is written under: the turn's command, not the platform. */
export const SANDBOX_OUT_OF_MEMORY_STOP_CAUSE = "failed";

/** How long a turn waits for room when the server sets no other limit: 15 minutes. */
export const DEFAULT_SANDBOX_WAIT_SECONDS = 900;

/** The Run's setup phase while its turn waits for room (`SetupProgress.current_phase`). */
export const SANDBOX_WAITING_PHASE_TEXT = "Waiting for a sandbox";

/** The stop kind of a turn whose wait for room ran out (`StigmerStopDetail.kind`, under `infrastructure`). */
export const SANDBOX_WAIT_STOP_KIND = "no_sandbox_room";

/** The stop cause a run out wait is written under. */
export const SANDBOX_WAIT_STOP_CAUSE = "infrastructure";

/** The longest pause between two asks for room. */
const SANDBOX_WAIT_MAX_BACKOFF_MS = 15_000;

/**
 * The pause before the `attempt`th ask again (from 1): linear, 5 s a step,
 * capped at 15 s, the recovery loop's idiom with a shorter cap so a turn
 * takes room within 15 s of it appearing.
 */
export function sandboxWaitBackoffMs(attempt: number): number {
  return Math.min(Math.max(attempt, 1) * 5_000, SANDBOX_WAIT_MAX_BACKOFF_MS);
}

/**
 * What one ask for the turn's sandbox came to (sandbox/session-sandbox.ts
 * `ensureSessionSandboxForExecution`): `ready`, `no_room`, `not_carried`
 * (its files cannot be carried to this server's runner: module header),
 * `out_of_memory` (it was killed for exceeding its memory limit and is
 * asleep again: module header), `skipped` (nothing to ensure) or `failed`
 * (logged and pre-stamped). Wire words: the EnsureSessionSandbox activity
 * returns them.
 */
export type SandboxEnsureOutcome =
  | "ready"
  | "no_room"
  | "not_carried"
  | "out_of_memory"
  | "skipped"
  | "failed";

/**
 * The EnsureSessionSandbox activity's input: the run, and the facts about
 * the caller whose request started it that the ensure hands the driver
 * (sandbox/provisioner.ts SandboxFacts). snake_case, as every payload this
 * workflow schedules.
 */
export interface EnsureSessionSandboxInput {
  readonly execution_id: string;
  readonly caller_class: string;
  /** The routine whose fire started the run; absent for every other request. */
  readonly routine_id?: string;
  /** The caller's id, minted for only under the trusted-local posture (sandbox/session-sandbox.ts). */
  readonly caller_identity_id?: string;
  /**
   * When the turn's wait for room began (workflow time, epoch ms), absent
   * on the first ask. The activity reports the wait's age from it, and on
   * an answer other than `no_room` clears the turn's waiting liveness.
   */
  readonly waiting_since_ms?: number;
}

/**
 * The turn's wait for room ran out (module header). Thrown inside the
 * workflow and read by its failure write; never crosses a payload.
 */
export class SandboxWaitRanOut extends Error {
  constructor(
    readonly limitSeconds: number,
    readonly waitedMs: number,
    /** The person's sentence; a shared turn's wait words it its own way (shared-turn.ts). */
    copy: string = sandboxWaitRanOutCopy(limitSeconds),
  ) {
    super(copy);
    this.name = "SandboxWaitRanOut";
  }
}

/**
 * The turn's sandbox cannot be carried to this server's runner (module
 * header). Thrown inside the workflow and read by its failure write; never
 * crosses a payload.
 */
export class SandboxNotCarried extends Error {
  constructor() {
    super(SANDBOX_NOT_CARRIED_COPY);
    this.name = "SandboxNotCarried";
  }
}

/**
 * The turn's sandbox was killed for exceeding its memory limit while the
 * turn was alive (module header). Thrown inside the workflow and read by
 * its failure write; never crosses a payload.
 */
export class SandboxOutOfMemory extends Error {
  constructor() {
    super(SANDBOX_OUT_OF_MEMORY_COPY);
    this.name = "SandboxOutOfMemory";
  }
}

/**
 * The person's sentence for a wait that ran out (status.error): how long
 * every sandbox was busy, that nothing was lost, and what running it again
 * does.
 */
export function sandboxWaitRanOutCopy(limitSeconds: number): string {
  if (limitSeconds <= 0) {
    return "Every sandbox was busy, so this turn didn't start. Nothing was lost: run it again once one is free.";
  }
  return `Every sandbox was busy for ${waitLength(limitSeconds)}, so this turn didn't start. Nothing was lost: run it again to wait for room.`;
}

/**
 * "45 seconds", "1 minute", "15 minutes": whole minutes from a minute on,
 * floored, so the sentence never says every sandbox was busy for longer
 * than the server waited.
 */
function waitLength(seconds: number): string {
  if (seconds < 60) {
    return seconds === 1 ? "1 second" : `${seconds} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
