/**
 * The schedule-fire caller seam (stigmer-cloud#572) — WHO a schedule fire
 * acts as when the RunStarter re-enters the execution create pipeline.
 *
 * With no driver composed a fire enters as the in-process `internal`
 * class — the trusted-local laptop's lane, where the one caller is the
 * server's operator and attribution has nobody to separate. Under an
 * authentication posture that lane is wrong: the internal class carries
 * the operator's email or `"system"`, which no enforcing evaluator
 * recognizes as a person, so the fired session would belong to nobody
 * (the FGA model's own words — "without it a scheduled run is invisible
 * to every human, including the schedule's owner"). Two drivers answer
 * it: the cloud edition mints a schedule JWT per fire (sub = the org's
 * system-schedule account, claim = the firing Schedule id) so the run
 * reaches the schedule's viewer set through the session#schedule link;
 * open source, under the built-in authorization posture, makes the fire
 * act as the schedule's CREATOR (authorization/schedule-fire-caller.ts),
 * so the run and its session are that person's. The fire then propagates
 * the identity through the R5 caller-propagation header exactly like the
 * other request-origin in-process creates.
 *
 * Single-instance point. The mint is per fire — the schedule id is a
 * claim of the minted credential, never a cached field. Two failure
 * shapes, and the RunStarter tells them apart by type, the store-fault
 * precedent (`ResourceNotFoundError` is checked with `instanceof`; every
 * other fault is infrastructure):
 *
 *   - any other thrown error is an INFRASTRUCTURE fault: the RunStarter
 *     lets it propagate, so the tick activity retries (the deterministic
 *     execution name absorbs the retry) and a manual trigger surfaces
 *     the failure to its caller;
 *   - `ScheduleFireCallerRefusedError` is a DETERMINISTIC refusal — this
 *     fire can act as nobody, and no retry will change that (a schedule
 *     stamped by no person this server knows). The RunStarter answers
 *     the `refused` outcome the way it answers a launch gate's refusal:
 *     the failure streak counts it and pauses the schedule with the
 *     reason, so the person who scheduled it sees why in the console
 *     instead of a tick failing quietly forever.
 */
import type { CallerIdentity } from "./identity.js";

export interface ScheduleFireCallerMint {
  /**
   * Mints the caller identity one fire acts as. `rawToken` must carry the
   * edition's verifiable credential for the identity when the edition
   * reads fire-scoped claims from it downstream (the cloud does — the
   * schedule id); an edition that propagates the identity in-process and
   * reads nothing off the token leaves it empty (open source does).
   */
  mintFireCaller(org: string, scheduleId: string): Promise<CallerIdentity>;
}

/**
 * The mint's deterministic refusal (the module header): thrown by a
 * driver when the fire can act as nobody and retrying cannot help. The
 * message is the reason the schedule's status carries, so it is written
 * for the person who scheduled the run.
 */
export class ScheduleFireCallerRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ScheduleFireCallerRefusedError";
  }
}
