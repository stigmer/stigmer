/**
 * The refusal an organization that requires sign-in through its SSO
 * provider gives anyone who signed in another way: PERMISSION_DENIED
 * carrying the reason SSO_REQUIRED, with the organization's id and the
 * provider's slug (`IdentityProviderSpec.sso_required` in the contract).
 * A console reads the reason, never the copy, and sends the person to the
 * organization's SSO sign-in instead of showing a bare refusal.
 */
import { getErrorReason } from "@stigmer/sdk";

/** The reason an organization's sign-in requirement refuses with. */
export const SSO_REQUIRED = "SSO_REQUIRED";

/** What a sign-in requirement's refusal names. */
export interface SsoRequirement {
  /** The organization's id. */
  readonly org: string;
  /** The organization's SSO provider's slug. */
  readonly provider: string;
}

/** The requirement `error` reports, or `null` for any other error. */
export function ssoRequirementOf(error: unknown): SsoRequirement | null {
  const reason = getErrorReason(error);
  if (reason?.reason !== SSO_REQUIRED) {
    return null;
  }
  return { org: reason.metadata.org ?? "", provider: reason.metadata.provider ?? "" };
}
