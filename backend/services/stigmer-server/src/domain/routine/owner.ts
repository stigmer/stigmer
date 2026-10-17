/**
 * Who a routine's runs act as: its OWNER, the account that created it, in
 * every edition. Stated once here for the run starter (every fire) and the
 * update lane's owner's lock (only the owner changes what it runs).
 *
 * Why the creator: every run acts as one person, who the run's
 * conversation belongs to and whose `can_execute` on the agent the run
 * create asks again at each fire. The creator is the one person the row
 * names; a routine that must outlive a person is created by a service
 * account. The trusted-local laptop is the exception, and the run starter
 * makes it: it has one person and no accounts to act as, so its fires keep
 * the laptop's own identity.
 *
 * The owner's account is resolved from the row's creator stamp through the
 * identity-account domain's `accountForStamp` — as an account id (rows
 * stamped since 3.15.0) and as the raw issuer subject (rows the 3.14.x
 * verifiers stamped), the same two shapes `Person` aliases. A stamp that
 * resolves to no account is a DETERMINISTIC refusal
 * (`RoutineFireRefusedError`): the empty stamp, the laptop's `"system"`, an
 * email from the trusted-local era, a deleted account — no retry will make
 * that routine anyone's, so a fire pauses it with this message rather than
 * failing every tick, and nobody but the server may change what it runs. A
 * store fault is an infrastructure throw.
 *
 * `ownerAsFireCaller` is the fire-caller seam's default
 * (extensions/routine-fire-caller.ts): the owner acting as themselves,
 * `accountAsCaller` (domain/identityaccount/actor.ts). An edition that
 * reads a verifiable credential downstream composes its own.
 *
 * Proven by __tests__/owner.postgres.test.ts and the run starter's suite.
 */
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { RoutineFireCaller } from "../../extensions/routine-fire-caller.js";
import { RoutineFireRefusedError } from "../../extensions/routine-fire-caller.js";
import { auditOf } from "../../pipeline/steps/defaults.js";
import { accountAsCaller } from "../identityaccount/actor.js";
import { accountForStamp } from "../identityaccount/resolve.js";
import type { AccountsByCaller } from "../identityaccount/resolve.js";

/** The refusal's copy — written for the person who made the routine (its status carries it). */
export function routineHasNoOwnerMessage(routineId: string): string {
  return `routine ${routineId} was created by nobody this server recognizes as a person; recreate it while signed in`;
}

/** The account `routine`'s runs act as, or the deterministic refusal when its stamp names nobody. */
export async function resolveRoutineOwner(
  accounts: AccountsByCaller,
  routine: Routine,
): Promise<IdentityAccount> {
  const stamp = auditOf(RoutineSchema, routine)?.specAudit?.createdBy?.id ?? "";
  const account = await accountForStamp(accounts, stamp);
  if (account === undefined) {
    throw new RoutineFireRefusedError(routineHasNoOwnerMessage(routine.metadata?.id ?? ""));
  }
  return account;
}

/** The fire-caller seam's default: the owner, acting as themselves. */
export const ownerAsFireCaller: RoutineFireCaller = {
  callerFor: ({ owner }) => Promise.resolve(accountAsCaller(owner)),
};
