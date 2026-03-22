// ---------------------------------------------------------------------------
// OIDC UserManager factory
//
// Creates a configured oidc-client-ts UserManager from the Stigmer OidcConfig.
// The UserManager handles the full OIDC lifecycle: Authorization Code + PKCE
// flow, token storage, silent renewal, and logout.
//
// Auth0-specific: The `audience` parameter is passed as an extra query
// parameter on the /authorize request. This tells Auth0 to issue a JWT
// access token scoped to the API, rather than an opaque token.
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
    post_logout_redirect_uri: config.postLogoutRedirectUri ?? origin,
    scope: config.scopes?.join(" ") ?? DEFAULT_SCOPES,
    response_type: "code",
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: sessionStorage }),
    extraQueryParams: { audience: config.audience },
  });
}
