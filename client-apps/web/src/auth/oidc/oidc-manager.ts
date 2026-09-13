// ---------------------------------------------------------------------------
// OIDC UserManager factory
//
// Creates a configured oidc-client-ts UserManager from the Stigmer OidcConfig.
// The UserManager handles the full OIDC lifecycle: Authorization Code + PKCE
// flow, token storage, silent renewal, and logout.
//
// The two URIs below are the pair an operator registers at their identity
// provider for the console (docs/guides/self-hosting/authentication.mdx):
// the redirect URI `/auth/callback` and the post-logout URI `/login`, both
// on the console's own origin (20260913.02 Q-CL-9: one signed-out landing
// for both sign-out arms).
//
// The `audience` extra query parameter is how Auth0 is told to mint a JWT
// access token for the API instead of an opaque one; standards-compliant
// issuers that do not know the parameter ignore it (Keycloak, Okta, Dex
// carry the audience through their own client configuration instead).
// ---------------------------------------------------------------------------

import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { OidcConfig } from "./types";

const DEFAULT_SCOPES = "openid email profile offline_access";

/**
 * Create an oidc-client-ts {@link UserManager} from Stigmer OIDC config.
 *
 * The manager is configured for Authorization Code + PKCE (no client secret).
 * Tokens are stored in `sessionStorage` (cleared when the tab closes).
 */
export function createUserManager(config: OidcConfig): UserManager {
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: `${origin}/auth/callback`,
    post_logout_redirect_uri: config.postLogoutRedirectUri ?? `${origin}/login`,
    scope: config.scopes?.join(" ") ?? DEFAULT_SCOPES,
    response_type: "code",
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: sessionStorage }),
    extraQueryParams: { audience: config.audience },
  });
}
