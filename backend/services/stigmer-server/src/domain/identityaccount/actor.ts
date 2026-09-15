/**
 * An account acting as itself — the ONE construction of the caller
 * identity server code stamps when it acts on a person's behalf without
 * a token in hand. The shape is the trusted-local identity's
 * (pipeline/interceptors/auth.ts trustedLocalIdentityFor: no issuer, no
 * token; email and display name only when known) with the account id as
 * the principal, so the audit actor on every write it makes is the
 * account, named the way every other write names it.
 *
 * Two lanes build it: the trusted-local boot ensure, which grants the
 * operator ownership AS their account (domain/iampolicy/membership.ts),
 * and the built-in schedule fire caller, which makes a fire act as the
 * schedule's creator (authorization/schedule-fire-caller.ts). Both ride
 * the in-process transport, whose interceptor stamps `origin:
 * "in-process"` on top — the transport-trust marker is never set here.
 *
 * Why not a token: open source mints no credential for a person the
 * server is composing a request for; the identity is what the
 * propagation header carries, and every consumer that reads a subject off
 * the raw token (`idpIdOf`) is reached only through `accountForCaller`,
 * which resolves this identity by its id first and never asks the token.
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { CallerIdentity } from "../../extensions/identity.js";

export function accountAsCaller(account: IdentityAccount): CallerIdentity {
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
    callerClass: "user",
    issuer: "",
    rawToken: "",
    ...(email !== "" ? { email } : {}),
    ...(displayName !== "" ? { displayName } : {}),
  };
}
