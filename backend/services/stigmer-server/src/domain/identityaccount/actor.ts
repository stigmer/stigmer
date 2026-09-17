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

/** The account id as principal, with the display identity the row knows. */
function principalOf(
  account: IdentityAccount,
): Pick<CallerIdentity, "identityId" | "email" | "displayName"> {
  const accountId = account.metadata?.id ?? "";
  if (accountId === "") {
    throw new Error(
      "identity account carries no id — refusing to build a caller for an empty principal",
    );
  }
  const email = account.spec?.email ?? "";
  const displayName = account.metadata?.name ?? "";
  return {
    identityId: accountId,
    ...(email !== "" ? { email } : {}),
    ...(displayName !== "" ? { displayName } : {}),
  };
}
