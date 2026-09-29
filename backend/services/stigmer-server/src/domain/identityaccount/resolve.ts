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
 *
 * The fourth reading asks of a stamp that named nobody whether it is the
 * operator's from before sign-in was turned on:
 * `isPreSignInOperatorStamp` (stigmer/stigmer#1169). Under the
 * trusted-local posture every write is stamped with the operator's email,
 * or with the "system" placeholder when no email is configured, and the
 * operator's account carries the subject `local|<that stamp>`. After
 * sign-in the operator signs in as a different account, one derived from
 * the issuer's subject, which by construction never collides with a
 * `local|` one (constants.ts). So such a stamp names a principal no
 * signed-in person is. The API-key verifier asks this so it can refuse
 * such a key by name instead of admitting a bare email. The answer is yes
 * for "system" with no read, and for any other stamp when the store holds
 * `local|<stamp>`, which is one direct-subject read. An account-id stamp
 * and the empty stamp answer no with no read: the common key costs its
 * verifier nothing.
 *
 * The fifth reading asks of a caller whether the platform's own sign-in
 * vouched for it: `mayProvisionDirectAccount`, provisionMyAccount's
 * admission. That RPC provisions the DIRECT account of the credential's
 * subject, and a subject names a direct account only when the lane that
 * admitted the caller is one of the platform's own. Every such lane
 * resolves its caller through `identityIdForSubject` and stamps the `user`
 * class, so its caller is either idp-shaped (no account, and the identity
 * is the subject itself) or the direct account of that subject. Anything
 * else was vouched for by another lane: an organization's identity
 * provider stamps its own federated account, a platform client's user
 * token its own account, a system lane its lane account or raw lane
 * subject. Their `sub` is theirs to choose, so provisioning by it would
 * hand them a platform person's row, or create one under the subject with
 * a profile fetched from their own issuer. The trusted-local operator, who
 * carries no issuer and no token, is the posture's own and is admitted.
 * Two primary-key reads; faults propagate as they are.
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { SYSTEM_OPERATOR_IDENTITY_ID } from "../../pipeline/interceptors/auth.js";
import { idpIdOf, isAccountIdShaped, localIdpIdFor } from "./constants.js";
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

/**
 * Whether a creator stamp is the operator's from before sign-in was turned
 * on: the "system" placeholder, or an email whose `local|<email>` account
 * the store holds. Faults propagate as they are.
 */
export async function isPreSignInOperatorStamp(
  accounts: AccountsBySubject,
  stamp: string,
): Promise<boolean> {
  if (stamp === SYSTEM_OPERATOR_IDENTITY_ID) {
    return true;
  }
  if (stamp === "" || isAccountIdShaped(stamp)) {
    return false;
  }
  return (await accounts.findDirectByIdpId(localIdpIdFor(stamp))) !== undefined;
}

/**
 * Whether provisionMyAccount may provision the direct account of
 * `subject` (the caller's `idpIdOf`) for `caller`: the trusted-local
 * operator; or a `user`-class caller that is idp-shaped (no account under
 * its identity, which is the subject itself) or is already that subject's
 * direct account. Faults propagate as they are.
 */
export async function mayProvisionDirectAccount(
  accounts: AccountsByCaller,
  caller: CallerIdentity,
  subject: string,
): Promise<boolean> {
  if (caller.issuer === "" && caller.rawToken === "") {
    return true;
  }
  if (caller.callerClass !== "user" || subject === "") {
    return false;
  }
  const standing = await accounts.findById(caller.identityId);
  if (standing === undefined) {
    return caller.identityId === subject;
  }
  const standingId = standing.metadata?.id ?? "";
  const direct = await accounts.findDirectByIdpId(subject);
  return standingId !== "" && direct?.metadata?.id === standingId;
}
