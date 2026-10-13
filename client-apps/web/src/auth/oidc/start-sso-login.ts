// ---------------------------------------------------------------------------
// Starting a sign-in through an organization's SSO provider.
//
// The one place the console sends a person to an organization's own
// identity provider: the login page's SSO button, the "Sign in with ..."
// button an SSO_REQUIRED refusal offers, and the access move's second step.
// It records the provider for the callback (`saveSsoLoginState`), records
// where to land afterwards, and redirects through the OIDC Authorization
// Code flow with PKCE. The callback (OidcAuthProvider) makes the provider's
// session the tab's active one and lands on `redirectPath`.
// ---------------------------------------------------------------------------

import type { SsoProviderInfo } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { createUserManager } from "./oidc-manager";
import { saveSsoLoginState } from "./sso-session";

/** Where the callback lands, read and cleared by OidcAuthProvider. */
export const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";

/** Redirects to `provider` for `org`, landing on `redirectPath` once signed in. */
export function startSsoLogin(provider: SsoProviderInfo, org: string, redirectPath = "/"): Promise<void> {
  saveSsoLoginState({
    issuer: provider.issuer,
    clientId: provider.oidcClientId,
    audience: provider.expectedAudience,
    org,
  });
  sessionStorage.setItem(REDIRECT_PATH_KEY, redirectPath);
  const extraQueryParams: Record<string, string> = {};
  if (provider.expectedAudience) {
    extraQueryParams.audience = provider.expectedAudience;
  }
  return createUserManager({
    issuer: provider.issuer,
    clientId: provider.oidcClientId,
    audience: provider.expectedAudience,
  }).signinRedirect({ extraQueryParams });
}
