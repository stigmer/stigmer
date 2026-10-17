/**
 * The routine fire-caller seam — the credential a routine's fire presents
 * when the run starter re-enters the run create pipeline.
 *
 * WHO a fire acts as is not this seam's question: core answers it once, in
 * every edition (domain/routine/owner.ts) — the routine's owner, except on
 * the trusted-local laptop, whose one person keeps the laptop's own
 * identity. This seam turns that owner into the identity the edition
 * presents for them. The default (`ownerAsFireCaller`) is the owner acting
 * as themselves, which open source propagates in-process and reads nothing
 * else from; an edition that reads a verifiable credential downstream (a
 * token naming the owner, scoped to the fire) composes its own.
 *
 * Whatever identity a driver returns, the run starter adds the routine to
 * it (`CallerIdentity.routineId`) before propagating it, so the session the
 * run creates records the routine it came from. A driver never sets it.
 *
 * Single-instance point. The call is per fire. Two failure shapes, and the
 * run starter tells them apart by type, the store-fault precedent
 * (`ResourceNotFoundError` is checked with `instanceof`; every other fault
 * is infrastructure):
 *
 *   - any other thrown error is an INFRASTRUCTURE fault: the run starter
 *     lets it propagate, so the tick activity retries (the deterministic
 *     run name absorbs the retry) and a fire call surfaces the failure to
 *     its caller;
 *   - `RoutineFireRefusedError` is a DETERMINISTIC refusal — this fire can
 *     act as nobody, and no retry will change that (a routine stamped by no
 *     person this server knows). The run starter answers the `refused`
 *     outcome the way it answers a launch gate's refusal: the failure
 *     streak counts it and pauses the routine with the reason, so the
 *     person who made it sees why in the console instead of a tick failing
 *     quietly forever.
 */
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { CallerIdentity } from "./identity.js";

/** The fire a credential is asked for. */
export interface RoutineFireCallerInput {
  /** The routine's organization. */
  readonly org: string;
  readonly routineId: string;
  /** The account the fire acts as: the routine's owner. */
  readonly owner: IdentityAccount;
}

export interface RoutineFireCaller {
  /** The identity one fire presents for its routine's owner. */
  callerFor(input: RoutineFireCallerInput): Promise<CallerIdentity>;
}

/**
 * The deterministic refusal (the module header): thrown when the fire can
 * act as nobody and retrying cannot help. The message is the reason the
 * routine's status carries, so it is written for the person who made the
 * routine.
 */
export class RoutineFireRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RoutineFireRefusedError";
  }
}
