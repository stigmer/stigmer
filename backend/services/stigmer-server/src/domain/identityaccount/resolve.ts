/**
 * Subject → identity resolution: the ONE statement of "which principal
 * does this subject get stamped as", `principalForSubject`, called by a
 * verifier after its own credential checks pass with the subject its
 * credential names (the OIDC lane with the token's `sub`). The principal
 * is the account id with the email and display name the account row
 * carries (actor.ts `principalOf`: the row wins, the credential's own
 * claims standing in where it says nothing), so a resource a person creates
 * names them, not just their id, however few profile claims their
 * provider puts in an access token (stigmer/stigmer#1226).
 * `identityIdForSubject` is the same read answering the id alone, kept
 * for compositions that call it until they adopt the principal.
 *
 * The rule is the cloud's direct-login posture (iam/direct/verifier.ts):
 * one primary-key read of the DIRECT account for the subject; a hit
 * stamps the account id, so the Authorizer, the audit actor and the
 * tuple lifecycle see one principal shape for every provisioned user; a
 * miss returns the subject unchanged, so an unprovisioned caller is
 * admitted idp-shaped and exactly two RPCs mean anything to them —
 * whoAmI (NOT_FOUND) and provisionMyAccount. No cache between the two
 * (the liveness posture): a row that appears is seen by the very next
 * request, a row that is deleted stops resolving on the next.
 *
 * It lives in the domain, not in a verifier, because it is the domain's
 * knowledge that a subject and an account are two names for one
 * principal; a verifier only knows which string it was handed. Stated
 * once, the platform's own sign-in lane and a composition's cannot drift.
 * An account id is never resolved through it: no account carries an
 * `ida_` as its subject, so the read could only miss. A stamp that may
 * be an account id is the third reading's, below.
 *
 * Faults: a store failure propagates as the error it is — the chassis
 * maps a non-ConnectError to INTERNAL (pipeline/interceptors/auth.ts),
 * so an outage never reads as a bad credential. A hit whose row carries
 * no id is the one deliberate divergence from the cloud's inline
 * `metadata?.id ?? ""`: a `""` principal is the silent-junk failure the
 * oss#405 doctrine forbids, so it is a loud fault naming the subject.
 *
 * The same knowledge read in the caller's direction is `accountForCaller`:
 * the account a stamped CallerIdentity stands for. Two primary-key
 * reads, the cloud's whoAmI order — the
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
 * `accountForCaller`'s order, with no subject read for an account-id
 * stamp the id read missed: no account carries an `ida_` as its subject,
 * so that read could only miss. Three lanes make the server act as the
 * person a row names: the built-in schedule fire caller (a fire acts as
 * the schedule's creator), the runner-subject verifier (a run credential
 * admits its bearer as the execution's creator) and the API-key verifier
 * (a key authenticates as its creator). Stated here so they cannot
 * resolve one stamp two ways; each decides for itself what "nobody"
 * means (the fire caller's deterministic refusal, the runner verifier's
 * liveness sentence, the key verifier's refusal of a deleted owner), so
 * this function answers `undefined` and never throws for it. The empty
 * stamp is `undefined` with no read.
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
 * resolves its caller through `principalForSubject` and stamps the `user`
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
import { principalOf } from "./actor.js";
import type { DisplayClaims } from "./actor.js";
import { idpIdOf, isAccountIdShaped, localIdpIdFor } from "./constants.js";
import type { IdentityAccountStore } from "./store.js";

/** The one read a verifier needs from the domain: the direct account for a subject. */
export type AccountsBySubject = Pick<IdentityAccountStore, "findDirectByIdpId">;

/** The two reads the caller-direction resolution needs: by id, then by subject. */
export type AccountsByCaller = Pick<
  IdentityAccountStore,
  "findById" | "findDirectByIdpId"
>;

/** The principal a verifier stamps: who the caller is, and what they are called. */
export type SubjectPrincipal = Pick<
  CallerIdentity,
  "identityId" | "email" | "displayName"
>;

/**
 * The principal `subject` stands for. A subject with a direct account is
 * that account, with the row's email and display name (`claims`
 * standing in where the row says nothing, actor.ts); a subject without one is
 * admitted idp-shaped, as itself with its `claims`. One primary-key read,
 * no cache; faults propagate as they are.
 */
export async function principalForSubject(
  accounts: AccountsBySubject,
  subject: string,
  claims: DisplayClaims = {},
): Promise<SubjectPrincipal> {
  const account = await accounts.findDirectByIdpId(subject);
  if (account === undefined) {
    return { identityId: subject, ...presentClaims(claims) };
  }
  if ((account.metadata?.id ?? "") === "") {
    throw new Error(
      `identity account for subject '${subject}' carries no id — refusing to stamp an empty principal`,
    );
  }
  return principalOf(account, claims);
}

/**
 * The id `principalForSubject` answers, alone: the same read and the
 * same faults.
 *
 * @deprecated Use `principalForSubject`, which also carries the account's
 * email and display name, so the caller's audit stamp names the person.
 */
export async function identityIdForSubject(
  accounts: AccountsBySubject,
  subject: string,
): Promise<string> {
  return (await principalForSubject(accounts, subject)).identityId;
}

/** The claims a credential asserted, with an empty field left out, as a verifier stamps them. */
function presentClaims(claims: DisplayClaims): DisplayClaims {
  return {
    ...(claims.email !== undefined && claims.email !== ""
      ? { email: claims.email }
      : {}),
    ...(claims.displayName !== undefined && claims.displayName !== ""
      ? { displayName: claims.displayName }
      : {}),
  };
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
  const byId = await accounts.findById(stamp);
  if (byId !== undefined || isAccountIdShaped(stamp)) {
    return byId;
  }
  return accounts.findDirectByIdpId(stamp);
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
