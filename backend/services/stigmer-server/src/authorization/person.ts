/**
 * The caller as the model sees them — `Person`, built ONCE here for every
 * built-in driver (the Authorizer, the organization directory, and the
 * list scope when it lands), so "who is asking" cannot be answered two
 * ways.
 *
 * Two steps, split so the pure half is testable without a store:
 *
 *   `resolvePerson(accounts, caller)` — the I/O: the account the caller
 *   stands for through `accountForCaller` (domain/identityaccount/
 *   resolve.ts, the domain's one statement of that question — the two
 *   reads whoAmI makes), then `personFor`.
 *
 *   `personFor(caller, account)` — the pure half: the account id the
 *   IamPolicy rows name, and every string a creator stamp may carry for
 *   the same human. A provisioned caller carries the account id and the
 *   account's issuer subject (rows the 3.14.x verifiers stamped with the
 *   raw `sub` still match — the alias rule); an unprovisioned one
 *   is their identity id alone and holds no rows. Nothing else is an
 *   alias: an email stamp is nobody's, in the membership rules and here.
 *
 * Refuses an identity that names no person — the empty id and the
 * unconfigured laptop's `"system"` placeholder — with the same predicate
 * the derivation uses to keep such stamps out of tuples (`isPersonStamp`,
 * the membership rules'). The two guards together are what make the
 * evaluator's alias comparison a plain set membership: no tuple side and
 * no person side ever carries a non-person string. Under the
 * require-authentication posture neither id reaches a check (the
 * verifiers stamp accounts or subjects; the in-process class skips
 * authorization; the driver's own arm denies the empty id first), so the
 * throw is the backstop for a caller built outside those lanes, and the
 * driver folds it to `unavailable`.
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { isPersonStamp } from "../domain/iampolicy/membership.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import { accountForCaller } from "../domain/identityaccount/resolve.js";
import type { CallerIdentity } from "../extensions/identity.js";
import type { Person } from "./tuples.js";

export type { AccountsByCaller } from "../domain/identityaccount/resolve.js";

export function personFor(
  caller: CallerIdentity,
  account: IdentityAccount | undefined,
): Person {
  const accountId = account?.metadata?.id ?? caller.identityId;
  if (!isPersonStamp(accountId)) {
    throw new Error(
      `caller '${accountId}' names no person — the built-in authorizer evaluates people only`,
    );
  }
  const aliases = new Set<string>([accountId]);
  const subject = account?.spec?.idpId ?? "";
  if (subject !== "") {
    aliases.add(subject);
  }
  return { accountId, aliases };
}

/** The person a caller is, read through the account port; faults propagate as they are. */
export async function resolvePerson(
  accounts: AccountsByCaller,
  caller: CallerIdentity,
): Promise<Person> {
  return personFor(caller, await accountForCaller(accounts, caller));
}
