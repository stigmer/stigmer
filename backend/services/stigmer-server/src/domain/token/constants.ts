/**
 * The token domain's pinned vocabulary: the user token's claim names and
 * every refusal sentence the mint, the user-token verifier and the origin
 * guard answer.
 *
 * The provisioning refusals (an unknown person, a blank or separated
 * subject part, a foreign account, a failed provisioning) and the origin
 * refusal keep the sentences integrators have read since the Java service,
 * with the settings they name moved to the organization's embedding
 * settings; the rest follow the house style (single-quoted handles).
 * Pinned cross-edition by the user-token conformance suites.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { grantableRolesFor } from "../../pipeline/apiresource-meta.js";

/**
 * The claims the user token carries beside the envelope's. `minted_by`
 * names the service account whose key minted the token: the verifier
 * reads it to keep the token alive only while that account exists, and
 * the audit records it on everything the person writes.
 */
export const USER_TOKEN_CLAIMS = {
  subject: "sub",
  externalUserId: "ext_user_id",
  email: "email",
  name: "name",
  org: "org",
  mintedBy: "minted_by",
} as const;

/** The mint response's token_type. */
export const BEARER_TOKEN_TYPE = "Bearer";

export const MINT_REQUIRES_SERVICE_ACCOUNT_MESSAGE =
  "mintUserToken is called with a service account's API key: create a service account with the admin role, create a key for it, and call mintUserToken from your product's backend with that key";

export function noAccountMessage(externalUserId: string, org: string): string {
  return `User '${externalUserId}' has no Stigmer account in organization '${org}'. Turn on create_accounts_on_sign_in in the organization's embedding settings or create the account first.`;
}

export const OWNER_SIGN_IN_ROLE_MESSAGE =
  "sign_in_role cannot be 'owner'; organization ownership must be assigned explicitly.";

/**
 * A sign-in role the organization kind does not grant
 * (`kind_meta.authorization.grantable_roles`): every first sign-in would
 * fail to grant it, so updateEmbedding refuses it, and the mint refuses
 * it for settings stored before that rule. The roles offered are the
 * grantable ones but owner, which the contract refuses on its own.
 */
export function signInRoleNotGrantableMessage(role: IamRole): string {
  const offered = grantableRolesFor(ApiResourceKind.organization)
    .filter((grantable) => grantable !== IamRole.owner)
    .map((grantable) => `'${IamRole[grantable]}'`);
  return `sign_in_role '${IamRole[role] ?? String(role)}' cannot be granted on an organization; set one of ${offered.join(", ")}, or leave it unset to grant nothing.`;
}

export const PROVISIONING_FAILED_MESSAGE =
  "Account provisioning failed. No partial account was left behind; the request is safe to retry.";

export function blankSubjectPartMessage(
  part: "org" | "externalUserId",
): string {
  return `${part} must not be null or blank`;
}

export function subjectSeparatorMessage(
  part: "org" | "externalUserId",
  value: string,
): string {
  return `${part} must not contain the separator character '|': ${value}`;
}

export function foreignAccountMessage(
  externalUserId: string,
  org: string,
): string {
  return `User '${externalUserId}' in organization '${org}' resolves to an account no mint created — refusing to mint a token for it`;
}

export const MINTING_REQUIRES_AUTHENTICATION_MESSAGE =
  "mintUserToken requires a server that authenticates its callers: this server trusts every request, so nothing would verify the token — configure an identity provider (STIGMER_OIDC_ISSUER) to enable user token minting";

export const MINTING_DISABLED_MESSAGE =
  "mintUserToken is disabled: this server's platform-token key ring holds no signing key";

export const GUEST_MINT_UNIMPLEMENTED_MESSAGE =
  "TokenService.mintGuestToken is not implemented: guest tokens for chat links are served by the Cloud edition";

export const TOKEN_NAMES_NO_MINTER_MESSAGE =
  "user token names no minting service account";

export const TOKEN_ORGANIZATION_MISMATCH_MESSAGE =
  "user token does not name its minting service account's organization or one of its child organizations";

export const DELETED_MINTER_MESSAGE =
  "The service account that minted this token has been deleted, so the token is no longer accepted. Mint a new user token with an active service account's key.";

export function originRefusalMessage(origin: string): string {
  return `Request origin '${origin}' is not in the organization's embedding allowed_origins. Add it to allowed_origins in the organization's embedding settings to permit browser requests from this origin.`;
}
