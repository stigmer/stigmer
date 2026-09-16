/**
 * Subject → identity resolution (20260911.11; T01_0_plan.md Q-IA-2,
 * T01_1_review.md A1 and A6): the ONE statement of "what identityId does
 * this subject get stamped with", called by every verifier after its own
 * credential checks pass — the OIDC lane with the token's `sub`, the
 * API-key lane with the key's creator stamp.
 *
 * The rule is the cloud's direct-login posture (iam/direct/verifier.ts):
 * one primary-key read of the DIRECT account for the subject; a hit
 * stamps the account id, so the Authorizer, the audit actor and the
 * tuple lifecycle see one principal shape for every provisioned user; a
 * miss returns the subject unchanged, so an unprovisioned caller is
 * admitted idp-shaped and exactly two RPCs mean anything to them —
 * whoAmI (NOT_FOUND) and provisionMyAccount. No cache between the two
 * (Q5's liveness posture): a row that appears is seen by the very next
 * request, a row that is deleted stops resolving on the next.
 *
 * It lives in the domain, not in either verifier, because it is the
 * domain's knowledge that a subject and an account are two names for one
 * principal; a verifier only knows which string it was handed. Stated
 * once, both lanes cannot drift, and a stamp that is already an account
 * id needs no special case: no account carries an `ida_` as its subject,
 * so the read is a miss and the stamp is kept.
 *
 * Faults: a store failure propagates as the error it is — the chassis
 * maps a non-ConnectError to INTERNAL (pipeline/interceptors/auth.ts),
 * so an outage never reads as a bad credential. A hit whose row carries
 * no id is the one deliberate divergence from the cloud's inline
 * `metadata?.id ?? ""`: a `""` principal is the silent-junk failure the
 * oss#405 doctrine forbids, so it is a loud fault naming the subject.
 *
 * The same knowledge read in the caller's direction is `accountForCaller`
 * (20260913.01 slice 4, Q-S4-1): the account a stamped CallerIdentity
 * stands for. Two primary-key reads, the cloud's whoAmI order — the
 * identityId AS an account id (a verifier that resolved), then the
 * caller's subject through the direct lookup (a verifier that did not:
 * the trusted-local interceptor, which stamps the operator's email and
 * never consults the store; a composition verifier that runs before any
 * row exists). It lives here so whoAmI and the built-in role lifecycle,
 * which asks "whose organization is this" from the creating caller,
 * cannot answer the same question two ways. A credential naming no
 * subject is `undefined` with no second read: the store is never asked
 * about "".
 *
 * The third reading is a ROW's creator stamp, `accountForStamp`: the
 * account a `created_by.id` names, read the two ways a stamp has been
 * written — as an account id (rows stamped since 3.15.0) and as the raw
 * issuer subject (rows the 3.14.x verifiers stamped) — in
 * `accountForCaller`'s order. Two lanes make the server act as the
 * person a row names: the built-in schedule fire caller (a fire acts as
 * the schedule's creator) and the runner-subject verifier (a run
 * credential admits its bearer as the execution's creator). Stated here
 * so they cannot resolve one stamp two ways; each decides for itself
 * what "nobody" means (the fire caller's deterministic refusal, the
 * verifier's liveness sentence), so this function answers `undefined`
 * and never throws for it. The empty stamp is `undefined` with no read.
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { idpIdOf } from "./constants.js";
import type { IdentityAccountStore } from "./store.js";

/** The one read a verifier needs from the domain: the direct account for a subject. */
export type AccountsBySubject = Pick<IdentityAccountStore, "findDirectByIdpId">;

/** The two reads the caller-direction resolution needs: by id, then by subject. */
export type AccountsByCaller = Pick<
  IdentityAccountStore,
  "findById" | "findDirectByIdpId"
>;

export async function identityIdForSubject(
  accounts: AccountsBySubject,
  subject: string,
): Promise<string> {
  const account = await accounts.findDirectByIdpId(subject);
  if (account === undefined) {
    return subject;
  }
  const id = account.metadata?.id ?? "";
  if (id === "") {
    throw new Error(
      `identity account for subject '${subject}' carries no id — refusing to stamp an empty principal`,
    );
  }
  return id;
}

/**
 * The account `caller` stands for, or `undefined` when there is none (an
 * idp-shaped caller before provisioning; a credential naming no subject).
 * Faults propagate as they are — the caller decides the wire shape.
 */
export async function accountForCaller(
  accounts: AccountsByCaller,
  caller: CallerIdentity,
): Promise<IdentityAccount | undefined> {
  const byId = await accounts.findById(caller.identityId);
  if (byId !== undefined) {
    return byId;
  }
  const subject = idpIdOf(caller);
  if (subject === "") {
    return undefined;
  }
  return accounts.findDirectByIdpId(subject);
}

/**
 * The account a row's creator stamp names, or `undefined` when it names
 * nobody (the laptop's `"system"`, a trusted-local email, a deleted
 * account, the empty stamp). Faults propagate as they are.
 */
export async function accountForStamp(
  accounts: AccountsByCaller,
  stamp: string,
): Promise<IdentityAccount | undefined> {
  if (stamp === "") {
    return undefined;
  }
  return (
    (await accounts.findById(stamp)) ??
    (await accounts.findDirectByIdpId(stamp))
  );
}
