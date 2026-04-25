/**
 * PKCE (Proof Key for Code Exchange) utilities for Auth0 authorization.
 *
 * Mirrors the CLI's PKCE flow (config.go / login.go) in TypeScript.
 * These values are public metadata, not secrets.
 */

export const AUTH0_DOMAIN = "https://stigmer-prod.us.auth0.com";
export const AUTH0_CLIENT_ID = "Ix1qNUI0uC82GPmghcrThei8IjtjIEA0";
export const AUTH0_AUDIENCE = "https://api.stigmer.com/";
export const AUTH0_SCOPES = "openid profile email offline_access";

/**
 * Generate a cryptographically random code verifier (43-128 chars, URL-safe).
 */
export function generateVerifier(length = 64): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Derive the S256 code challenge from a code verifier.
 */
export async function generateChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Shape of tokens stored in secure storage. */
export interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly idToken?: string;
}

/**
 * Build the Auth0 authorization URL with PKCE parameters.
 */
export function buildAuthorizeUrl(params: {
  codeChallenge: string;
  state: string;
  redirectUri: string;
}): string {
  const url = new URL(`${AUTH0_DOMAIN}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", AUTH0_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", AUTH0_SCOPES);
  url.searchParams.set("audience", AUTH0_AUDIENCE);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "login");
  return url.toString();
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: AUTH0_CLIENT_ID,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(`${AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    idToken: data.id_token,
  };
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: AUTH0_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(`${AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
    idToken: data.id_token,
  };
}
