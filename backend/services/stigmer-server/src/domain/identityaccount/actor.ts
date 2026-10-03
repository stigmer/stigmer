/**
 * An account acting as itself — the ONE place server code builds the
 * caller identity for a person it has resolved from a row rather than
 * from the token that person presented. Two constructions, one shape:
 * the account id is the principal, so the audit actor on every write
 * names the account the way every other write names it, and email and
 * display name ride along when the row knows them (the trusted-local
 * identity's shape, pipeline/interceptors/auth.ts).
 *
 * `accountAsCaller(account)` — the IN-PROCESS lane: no issuer, no token,
 * class `user`. Two consumers: the trusted-local boot ensure, which
 * grants the operator ownership AS their account
 * (domain/iampolicy/membership.ts), and the built-in schedule fire
 * caller, which makes a fire act as the schedule's creator
 * (authorization/schedule-fire-caller.ts). Both ride the in-process
 * transport, whose interceptor stamps `origin: "in-process"` on top —
 * the transport-trust marker is never set here.
 *
 * `accountAsRunnerCaller(account, rawToken)` — the WIRE lane: the
 * runner-subject verifier (runnerauth/runner-subject-verifier.ts) admits
 * the bearer of a run credential as the human whose run it is. Class
 * `runner`, because the Authorizer's lane admission and the memory
 * capture gate must tell a runner acting as a person from the person
 * (extensions/identity.ts names the class for exactly this), and the
 * verified token carried, because the provider's capabilities re-read the
 * binding off `rawToken` (the cloud's own pattern) — one HMAC, no store
 * read. No issuer: the server signed it.
 *
 * Why not a token for the in-process lane: open source mints no
 * credential for a person the server is composing a request for; the
 * identity is what the propagation header carries, and every consumer
 * that reads a subject off the raw token (`idpIdOf`) is reached only
 * through `accountForCaller`, which resolves this identity by its id
 * first and never asks the token. The same holds for the runner lane:
 * our token carries no `sub`, and nothing downstream needs one.
 *
 * The same row answers for a person a VERIFIER has resolved: the
 * platform's sign-in lane (identity/oidc-verifier.ts, through
 * `principalForSubject` in resolve.ts) and the API-key lane
 * (domain/apikey/verifier.ts, through `accountForStamp`) build their
 * caller's principal with `principalOf`, so a resource a person creates
 * names them the same way whichever credential they presented
 * (stigmer/stigmer#1226). Those lanes also hold what the credential
 * asserted (a token's `email` and `name` claims, the key's creator
 * stamp), and the row wins: the account is the platform's record and
 * survives a profile change at the identity provider, while a claim is
 * one token's snapshot, and many providers mint access tokens with no
 * profile claims at all (Auth0's carry none by default). The email is
 * the row's whenever it has one. The display name is the row's person
 * name (first and last) whenever it has one; when it has none, the
 * credential's name comes before the account's own name and email,
 * which are labels rather than a name: a provisioned account is named
 * by its email, so on an issuer whose userinfo gives no first or last
 * name, a real `name` claim would otherwise lose to the address.
 *
 * `accountDisplayName` is the one rule for what a person is called:
 * first and last name, then either alone, then the account's own name,
 * then its email. The account's name comes before the email because the
 * trusted-local operator account carries its configured display name
 * there with empty first and last names (operator.ts), while a
 * provisioned account is named by its email and gets first and last
 * names from the provider's userinfo (provisioning.ts), so on a hosted
 * install the name arm and the email arm answer the same string. Every
 * audit actor built from a row, getActorInfo's answer and the access
 * listings (domain/iampolicy/display-resolver.ts) share it, so a person
 * reads the same on a stamp, in the actor lookup a console renders the
 * stamp with, and in a member list.
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { CallerIdentity } from "../../extensions/identity.js";

export function accountAsCaller(account: IdentityAccount): CallerIdentity {
  return {
    ...principalOf(account),
    callerClass: "user",
    issuer: "",
    rawToken: "",
  };
}

export function accountAsRunnerCaller(
  account: IdentityAccount,
  rawToken: string,
): CallerIdentity {
  if (rawToken === "") {
    throw new Error(
      "a runner caller carries the credential it presented — refusing to build one with none",
    );
  }
  return {
    ...principalOf(account),
    callerClass: "runner",
    issuer: "",
    rawToken,
  };
}

/** The display identity a credential asserted: a token's claims, a key's creator stamp. */
export interface DisplayClaims {
  readonly email?: string;
  readonly displayName?: string;
}

/**
 * The account id as principal, with the display identity the row knows:
 * the row's email, else the claim's; the row's person name, else the
 * claim's name, else the account's own name, else its email.
 */
export function principalOf(
  account: IdentityAccount,
  claims: DisplayClaims = {},
): Pick<CallerIdentity, "identityId" | "email" | "displayName"> {
  const accountId = account.metadata?.id ?? "";
  if (accountId === "") {
    throw new Error(
      "identity account carries no id — refusing to build a caller for an empty principal",
    );
  }
  const email = firstNonEmpty(account.spec?.email, claims.email);
  const displayName = firstNonEmpty(
    personNameOf(account),
    claims.displayName,
    account.metadata?.name,
    account.spec?.email,
  );
  return {
    identityId: accountId,
    ...(email !== "" ? { email } : {}),
    ...(displayName !== "" ? { displayName } : {}),
  };
}

/** What a person is called: first + last > first > last > the account's name > email. */
export function accountDisplayName(account: IdentityAccount): string {
  return firstNonEmpty(
    personNameOf(account),
    account.metadata?.name,
    account.spec?.email,
  );
}

/** The person's name the row carries: first + last, or either alone. */
function personNameOf(account: IdentityAccount): string {
  const firstName = account.spec?.firstName ?? "";
  const lastName = account.spec?.lastName ?? "";
  if (firstName !== "" && lastName !== "") {
    return `${firstName} ${lastName}`;
  }
  return firstNonEmpty(firstName, lastName);
}

function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string {
  return values.find((value) => value !== undefined && value !== "") ?? "";
}
