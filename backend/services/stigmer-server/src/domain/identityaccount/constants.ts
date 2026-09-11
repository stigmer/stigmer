/**
 * Identity-account domain constants (20260911.11, T01_1_review.md A1, A2,
 * A7): the derived account id, the one function that turns a caller into
 * an issuer subject, and the byte-pinned wire copy.
 *
 * The derived id (A1). A direct account's id is a pure function of its
 * subject: `ida_` + the top 130 bits of sha256(idp_id) as 26 lowercase
 * Crockford-base32 characters. The shape is indistinguishable from a
 * minted `{prefix}_{ulid}`, so nothing downstream learns a second id
 * grammar, and the PRIMARY KEY becomes the one home of "one account per
 * subject": the generic store has no secondary uniqueness and its save is
 * an upsert (`store/sqlite/store.ts`), so a lookup-then-insert on a scan
 * could never close the first-login race. Two replicas deriving the same
 * id converge by primary key with no migration and no second copy of any
 * field. The hash is one-way, so an issuer subject never leaks into the
 * `created_by.id` stamps that ride on every resource. The golden vectors in
 * __tests__/constants.test.ts are wire-adjacent contract: a change here
 * re-addresses every direct account open source ever created.
 *
 * `idpIdOf` (A2) is the ONE place a CallerIdentity becomes a subject. An
 * issuer-vouched token is read for its `sub` (already verified at
 * position 1, so this is a read of trusted state, never a verification);
 * a caller with no issuer and no token is the trusted-local operator,
 * whose subject is `local|<identityId>`. It deliberately knows nothing
 * about API keys: every verifier resolves its stamp to the account when
 * one exists (A6), so a credential's shape is the verifier's business.
 *
 * The copy moved from the cloud's iam/account/handlers.ts as-is: the CLI,
 * console and SDK show these sentences verbatim, so they are contract.
 */
import { createHash } from "node:crypto";

import type { CallerIdentity } from "../../extensions/identity.js";

/** The kind's id prefix (kind_meta `identity_account.id_prefix`). */
export const ACCOUNT_ID_PREFIX = "ida";

/** Crockford base32, lowercased — the alphabet every minted ULID id uses. */
const CROCKFORD_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const DERIVED_ID_CHARS = 26;
const DERIVED_ID_BITS = BigInt(DERIVED_ID_CHARS * 5);
const SHA256_BITS = 256n;

/**
 * The derived account id of a direct account with subject `idpId`. Pure,
 * total over non-empty input; an empty subject has no principal and so
 * no address — refused, never hashed.
 */
export function accountIdFor(idpId: string): string {
  if (idpId === "") {
    throw new Error("idp_id must not be empty");
  }
  const digest = createHash("sha256").update(idpId, "utf8").digest();
  let bits = 0n;
  for (const byte of digest) {
    bits = (bits << 8n) | BigInt(byte);
  }
  let top = bits >> (SHA256_BITS - DERIVED_ID_BITS);
  let encoded = "";
  for (let i = 0; i < DERIVED_ID_CHARS; i++) {
    encoded = CROCKFORD_ALPHABET[Number(top & 31n)] + encoded;
    top >>= 5n;
  }
  return `${ACCOUNT_ID_PREFIX}_${encoded}`;
}

/**
 * The subject namespace of the trusted-local posture. An OIDC subject is
 * `<connection>|<id>` by Auth0 convention; `local|` claims the same shape
 * for the one principal no issuer vouches for, so the derived ids of a
 * local operator and an OIDC user can never collide by construction.
 */
export const LOCAL_IDP_ID_PREFIX = "local|";

/** `local|<identityId>` — the trusted-local operator's subject. */
export function localIdpIdFor(identityId: string): string {
  return `${LOCAL_IDP_ID_PREFIX}${identityId}`;
}

/**
 * The issuer subject a caller stands for:
 *   - a caller with no issuer and no token is the trusted-local operator
 *     (`local|<identityId>`; identityId is the operator's email or
 *     "system" — pipeline/interceptors/auth.ts trustedLocalIdentity);
 *   - a token-bearing caller is its JWT `sub`, read from the raw token
 *     the verifier already proved; `""` when the token carries no
 *     readable subject (an opaque credential under an issuer), which
 *     the provisionMyAccount handler maps to the UNAUTHENTICATED arm.
 */
export function idpIdOf(caller: CallerIdentity): string {
  if (caller.issuer === "" && caller.rawToken === "") {
    return localIdpIdFor(caller.identityId);
  }
  return jwtSubjectOf(caller.rawToken);
}

/**
 * The cloud's jwtSubjectOf verbatim: the payload segment decoded, `sub`
 * when it is a string. Not a verification — the chain's position 1 did
 * that; this only reads a claim from trusted state.
 */
function jwtSubjectOf(rawToken: string): string {
  const segments = rawToken.split(".");
  if (segments.length !== 3) {
    return "";
  }
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1] ?? "", "base64url").toString("utf8"),
    ) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : "";
  } catch {
    return "";
  }
}

/**
 * Auth0's client-credentials subject shape (`<client_id>@clients`) — the
 * cloud's IsMachineAccountVerifier rule, the one input to
 * `is_machine_account`.
 */
export const MACHINE_ACCOUNT_SUFFIX = "@clients";

export function isMachineSubject(idpId: string): boolean {
  return idpId.endsWith(MACHINE_ACCOUNT_SUFFIX);
}

// ---------------------------------------------------------------------------
// Byte-pinned copy (the cloud handlers' sentences, moved as-is).
// ---------------------------------------------------------------------------

/** whoAmI for a caller with no account (NOT_FOUND). */
export const ACCOUNT_NOT_FOUND_FOR_CALLER_MESSAGE =
  "Identity account not found for the authenticated user";

/** provisionMyAccount for a caller whose credential names no subject (UNAUTHENTICATED). */
export const NO_IDP_ID_MESSAGE =
  "Cannot provision account: no IDP ID in authentication context";

/** provisionMyAccount when the issuer's userinfo cannot be read (UNAVAILABLE); the cause follows. */
export const USERINFO_UNAVAILABLE_PREFIX =
  "Failed to fetch user profile from identity provider: ";

/** get / getByEmail / getByIdpId / getActorInfo / update / delete on a missing account (NOT_FOUND). */
export function accountNotFoundMessage(handle: string): string {
  return `Identity account not found: ${handle}`;
}

/**
 * The cloud#393 gate's refusal (PERMISSION_DENIED): the create RPC admits
 * the platform's own pipelines only — machine-class callers and
 * server-composed (in-process) requests (T01_1_review.md A7).
 */
export const CREATE_IS_INTERNAL_MESSAGE =
  "this RPC is internal to the platform";

/**
 * The reason a composition with no IdentityFederation unit refuses the four
 * federation RPCs (UNIMPLEMENTED). The sentence a person can act on; the
 * method-naming prefix is the organization directory's absent-method shape
 * so clients matching on "is not implemented" keep working.
 */
export const FEDERATION_UNIMPLEMENTED_REASON =
  "federated identity accounts are served by the Enterprise and Cloud editions";

export function federationUnimplementedMessage(method: string): string {
  return `${method} is not implemented: ${FEDERATION_UNIMPLEMENTED_REASON}`;
}

/**
 * update with a changed spec.idp_id (FAILED_PRECONDITION; the schedule
 * domain's immutability shape, T01_1_review.md A1). The subject IS the
 * identity; a client that sends a different one has a bug it should hear
 * about, never a silent preserve.
 */
export function idpIdImmutableMessage(existingIdpId: string): string {
  return `spec.idp_id is immutable (account subject is '${existingIdpId}') — create a new account for a different subject`;
}
