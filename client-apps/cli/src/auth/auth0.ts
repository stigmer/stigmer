// Auth0 PKCE configuration for Stigmer Cloud.
//
// These values are public metadata for a Native/PKCE application — they are NOT
// secrets. An Auth0 client ID is a public identifier (like a username, not a
// password), and PKCE removes the need for a client secret entirely. The
// authorize/token endpoints are hardcoded because Auth0's URL structure is
// stable ({domain}/authorize, {domain}/oauth/token), saving an OIDC-discovery
// round-trip at login time. Kept byte-for-byte identical to the Go CLI.

export const AUTH0_DOMAIN = "https://stigmer-prod.us.auth0.com";
export const CLIENT_ID = "kIT6URf4HKn6YzrQVVFTFN63BrSJdTPM";
export const AUDIENCE = "https://api.stigmer.com/";
export const CALLBACK_PORT = 8088;
export const CALLBACK_PATH = "/auth/callback";

const SCOPES = ["openid", "profile", "email", "offline_access"] as const;

export const AUTHORIZE_URL = `${AUTH0_DOMAIN}/authorize`;
export const TOKEN_URL = `${AUTH0_DOMAIN}/oauth/token`;

/** The loopback redirect URI Auth0 calls back with the authorization code. */
export function callbackUrl(): string {
  return `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
}

/**
 * Build the Auth0 /authorize URL for the PKCE authorization-code flow.
 * `prompt=login` forces the login page even with an active session, enabling
 * account switching.
 */
export function buildAuthorizeUrl(params: { state: string; codeChallenge: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("audience", AUDIENCE);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "login");
  return url.toString();
}
