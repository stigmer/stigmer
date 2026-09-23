/**
 * The platform-client domain's pinned vocabulary: reserved names, the
 * user-token claim names and every refusal sentence.
 *
 * Most copy is wire contract inherited from Stigmer Cloud, which has
 * answered integrators with these exact sentences since the Java service:
 * the mint's credential, expiry, organization and provisioning refusals,
 * the system-managed and reserved-slug refusals, and the minting client's
 * liveness and origin refusals on every request its tokens bear (pinned
 * cross-edition by platformclient-enforcement.conformance.test.ts). The
 * sentences open source adds — a server that cannot mint, the guest
 * method's edition refusal, the mismatched-account guard — follow the
 * house style (single-quoted handles).
 */

/** The kind's name as the shared error constructors render it. */
export const PLATFORM_CLIENT_KIND_NAME = "PlatformClient";

/**
 * Slugs the platform keeps for its own clients: the cloud creates each
 * organization's system-managed share client under this one, so a user
 * client holding it would be adopted by the guest lane.
 */
export const RESERVED_PLATFORM_CLIENT_SLUGS: ReadonlySet<string> = new Set([
  "system-share-client",
]);

/** The claims the PlatformClient user token carries beside the envelope's. */
export const USER_TOKEN_CLAIMS = {
  subject: "sub",
  externalUserId: "ext_user_id",
  email: "email",
  name: "name",
  org: "org",
  platformClientId: "platform_client_id",
} as const;

/** The mint response's token_type. */
export const BEARER_TOKEN_TYPE = "Bearer";

export function reservedSlugMessage(slug: string): string {
  return `The slug '${slug}' is reserved for the platform's system-managed resources and cannot be used. If you did not provide a slug explicitly, it was derived from the resource name — choose a different name or provide an explicit slug.`;
}

/** The three mutations a system-managed client refuses. */
export type SystemManagedMutation = "updated" | "deleted" | "rotated";

export function systemManagedMessage(verb: SystemManagedMutation): string {
  return `This platform client is system-managed and cannot be ${verb}`;
}

export function referenceNotFoundMessage(org: string, slug: string): string {
  return `PlatformClient '${org}/${slug}' not found`;
}

export const INVALID_CLIENT_CREDENTIALS_MESSAGE =
  "Invalid client_id or client_secret";

export const EXPIRED_CLIENT_SECRET_MESSAGE =
  "PlatformClient secret has expired. Use rotateSecret to generate a new one.";

export function organizationMismatchMessage(owningOrg: string): string {
  return `org_id must be empty or the PlatformClient's owning organization ('${owningOrg}'); cross-organization minting is not supported`;
}

export function noAccountMessage(externalUserId: string, org: string): string {
  return `User '${externalUserId}' has no Stigmer account in organization '${org}'. Enable auto_provision_accounts on the PlatformClient or create the account first.`;
}

export const OWNER_AUTO_GRANT_MESSAGE =
  "auto_grant_role cannot be 'owner'; organization ownership must be assigned explicitly.";

export const PROVISIONING_FAILED_MESSAGE =
  "Account provisioning failed. No partial account was left behind; the request is safe to retry.";

export function blankSubjectPartMessage(part: "org" | "externalUserId"): string {
  return `${part} must not be null or blank`;
}

export function subjectSeparatorMessage(
  part: "org" | "externalUserId",
  value: string,
): string {
  return `${part} must not contain the separator character '|': ${value}`;
}

export function foreignAccountMessage(externalUserId: string, org: string): string {
  return `User '${externalUserId}' in organization '${org}' resolves to an account no platform client provisioned — refusing to mint a token for it`;
}

export const MINTING_REQUIRES_AUTHENTICATION_MESSAGE =
  "mintUserToken requires a server that authenticates its callers: this server trusts every request, so nothing would verify the token — configure an identity provider (STIGMER_OIDC_ISSUER) to enable PlatformClient token minting";

export const MINTING_DISABLED_MESSAGE =
  "mintUserToken is disabled: this server's platform-token key ring holds no signing key";

export const GUEST_MINT_UNIMPLEMENTED_MESSAGE =
  "PlatformClientTokenController.mintGuestToken is not implemented: guest tokens for shared agents are served by the Cloud edition";

export const TOKEN_NAMES_NO_CLIENT_MESSAGE =
  "platform token names no platform client";

export const DELETED_CLIENT_MESSAGE =
  "The platform client that minted this token has been deleted, so the token is no longer accepted. Mint a new user token from an active platform client.";

export function originRefusalMessage(origin: string): string {
  return `Request origin '${origin}' is not in this platform client's allowed_origins. Add it to the PlatformClient's allowed_origins to permit browser requests from this origin.`;
}
