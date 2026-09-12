// Constants and fixtures for the IdentityAccount domain (20260911.11).
// Domain: conformance support.
//
// The byte-pinned copy below is the cloud handlers' Java-era wording, moved
// into @stigmer/server as-is; both the identityaccount and direct-login
// suites assert it, so it is stated once here and nowhere else in the
// suites. The conformance suite deliberately never imports the server's
// constants — the literal IS the contract a client may match on.
//
// The two edit helpers exist because an IdentityAccount `update` is a
// full-envelope replace whose writable surface is narrow (T01_1_review.md
// A9): the request must carry the WHOLE fetched spec — `GuardImmutableSubject`
// compares the incoming `idp_id` to the stored one, so a request that drops
// the field (sends "") is FAILED_PRECONDITION, exactly what a client with a
// bug should hear. Spreading a fetched message (`{ ...me.spec, preferences }`)
// is also refused by the package's typecheck (`spec` may be undefined, so
// `$typeName` becomes optional). `clone` keeps every field and the type.
import { clone, create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountPreferencesSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";

export const IDENTITY_ACCOUNT_API_VERSION = "iam.stigmer.ai/v1";
export const IDENTITY_ACCOUNT_KIND = "IdentityAccount";

// whoAmI for an admitted subject with no account — the console's signal to
// call provisionMyAccount (the Java IdentityAccountWhoAmIHandler copy).
export const ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE =
  "Identity account not found for the authenticated user";

// get / getByEmail / getByIdpId for an unknown handle.
export function accountNotFoundMessage(handle: string): string {
  return `Identity account not found: ${handle}`;
}

// update that changes spec.idp_id (A1: the subject IS the identity).
export function idpIdImmutableMessage(subject: string): string {
  return `spec.idp_id is immutable (account subject is '${subject}') — create a new account for a different subject`;
}

// create over the wire as a user — the cloud#393 gate, core since A7.
export const CREATE_IS_INTERNAL_MESSAGE =
  "this RPC is internal to the platform";

// provisionMyAccount while the issuer's /userinfo is down; the cloud appends
// the cause, so suites assert the prefix.
export const USERINFO_UNAVAILABLE_PREFIX =
  "Failed to fetch user profile from identity provider: ";

// Auth0's subject shape for a database user; unique per call so no run ever
// meets a row a previous run left behind.
export function freshSubject(): string {
  return `auth0|conformance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// The fetched account with its preferences replaced — the console's one
// write. `undefined` clears them, so an arm can put an account back exactly
// as it found it (an absent message, not an empty one).
export function withPreferences(
  account: IdentityAccount,
  preferences:
    | MessageInitShape<typeof IdentityAccountPreferencesSchema>
    | undefined,
): IdentityAccount {
  const copy = clone(IdentityAccountSchema, account);
  specOf(copy).preferences =
    preferences === undefined
      ? undefined
      : create(IdentityAccountPreferencesSchema, preferences);
  return copy;
}

// The fetched account with a different subject — the request the server
// must refuse.
export function withIdpId(
  account: IdentityAccount,
  idpId: string,
): IdentityAccount {
  const copy = clone(IdentityAccountSchema, account);
  specOf(copy).idpId = idpId;
  return copy;
}

function specOf(
  account: IdentityAccount,
): NonNullable<IdentityAccount["spec"]> {
  if (account.spec === undefined) {
    throw new Error(
      `identity account ${account.metadata?.id ?? "(no id)"} came back with no spec`,
    );
  }
  return account.spec;
}
