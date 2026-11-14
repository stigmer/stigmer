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
// on the console's own origin (one signed-out landing for both sign-out
// arms).
//
// The `audience` extra query parameter is how Auth0 is told to mint a JWT
// access token for the API instead of an opaque one; standards-compliant
// issuers that do not know the parameter ignore it (Keycloak, Okta, Dex
// carry the audience through their own client configuration instead).
//
// A sign-up (`/login?signup=1`) is the same flow with one more request: show
// the create-account screen. Two arms, because issuers disagree on how to
// ask. A deployment that configured sign-up parameters (signup-params.ts)
// sends exactly those, for a provider that reads its own hint and ignores
// the standard. Otherwise the console sends the OpenID Connect standard
// `prompt=create`, but only when the issuer's discovery lists `create` in
// `prompt_values_supported`: an issuer that does not may answer
// `invalid_request`, so anything else is an ordinary sign-in. The
// per-call `extraQueryParams` replaces the manager's (oidc-client-ts does
// not merge them), so the sign-up map starts from the manager's own and
// keeps `audience`.
// ---------------------------------------------------------------------------

import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { SigninRedirectArgs } from "oidc-client-ts";
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

/**
 * The `signinRedirect` arguments that ask the issuer for its create-account
 * screen. Configured sign-up parameters win; without them, `prompt=create`
 * when the issuer advertises it; failing both (or when discovery cannot be
 * read), no extra arguments, which is an ordinary sign-in.
 */
export async function signupRedirectArgs(
  config: OidcConfig,
  manager: UserManager,
): Promise<SigninRedirectArgs> {
  const configured = config.signupQueryParams ?? {};
  if (Object.keys(configured).length > 0) {
    return {
      extraQueryParams: { ...manager.settings.extraQueryParams, ...configured },
    };
  }
  return (await issuerSupportsCreate(manager)) ? { prompt: "create" } : {};
}

async function issuerSupportsCreate(manager: UserManager): Promise<boolean> {
  try {
    const metadata = await manager.metadataService.getMetadata();
    // oidc-client-ts's metadata type has no prompt_values_supported.
    return (
      "prompt_values_supported" in metadata &&
      Array.isArray(metadata.prompt_values_supported) &&
      metadata.prompt_values_supported.includes("create")
    );
  } catch {
    return false;
  }
}
