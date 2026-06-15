// Auth0 token operations: exchange an authorization code for tokens, refresh an
// expired access token, and expose a token provider that refreshes silently.

import type { TokenProvider } from "@stigmer/sdk";
import { type Config, save } from "../config/index.js";
import { CliExitError, ExitCode } from "../errors/index.js";
import { CLIENT_ID, callbackUrl, TOKEN_URL } from "./auth0.js";

/** Normalized result of an Auth0 token endpoint call. */
export interface TokenSet {
  readonly accessToken: string;
  /** Present when `offline_access` was granted; may rotate on refresh. */
  readonly refreshToken?: string;
  /** Absolute expiry as an RFC 3339 string, derived from `expires_in`. */
  readonly expiresAt?: string;
}

// Refresh this many ms before the real expiry so an in-flight request never
// races the token going stale.
const EXPIRY_SKEW_MS = 60_000;

interface Auth0TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchange a PKCE authorization code for an access (+refresh) token. */
export async function exchangeCode(params: { code: string; codeVerifier: string }): Promise<TokenSet> {
  return postToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: params.code,
    redirect_uri: callbackUrl(),
    code_verifier: params.codeVerifier,
  });
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  return postToken({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
}

/**
 * A token provider for the backend client that keeps the access token fresh.
 *
 * Precedence and behavior, evaluated per request:
 *   1. STIGMER_API_KEY (env / bridged --api-key) wins and is never refreshed.
 *   2. A non-expired access token is returned as-is.
 *   3. An expired token with a refresh token is refreshed; the new token,
 *      rotated refresh token, and expiry are persisted, then returned.
 *   4. Otherwise the (possibly stale) token or null is returned, letting the
 *      server reject it so the error maps to a clear "please log in" exit.
 *
 * Closes over `config` so a refresh updates the same object the rest of the
 * command sees, and writes it through to disk.
 */
export function createRefreshingTokenProvider(config: Config): TokenProvider {
  return async (): Promise<string | null> => {
    const envKey = process.env.STIGMER_API_KEY;
    if (envKey !== undefined && envKey !== "") return envKey;

    const cloud = config.backend.cloud;
    if (cloud?.token === undefined || cloud.token === "") {
      return cloud?.refresh_token ? refreshAndPersist(config, cloud.refresh_token) : null;
    }
    if (!isExpired(cloud.token_expiry)) return cloud.token;
    if (cloud.refresh_token === undefined || cloud.refresh_token === "") return cloud.token;
    return refreshAndPersist(config, cloud.refresh_token);
  };
}

async function refreshAndPersist(config: Config, refreshToken: string): Promise<string | null> {
  let next: TokenSet;
  try {
    next = await refreshAccessToken(refreshToken);
  } catch {
    // Refresh failed (revoked/expired refresh token). Fall back to the current
    // token if any; the server will reject it and the user is prompted to log in.
    return config.backend.cloud?.token ?? null;
  }
  const cloud = config.backend.cloud ?? {};
  cloud.token = next.accessToken;
  if (next.refreshToken !== undefined) cloud.refresh_token = next.refreshToken;
  cloud.token_expiry = next.expiresAt;
  config.backend.cloud = cloud;
  save(config);
  return next.accessToken;
}

function isExpired(expiresAt: string | undefined): boolean {
  // Legacy tokens persisted without an expiry are assumed valid; the server is
  // the ultimate authority and a 401 triggers re-login.
  if (expiresAt === undefined || expiresAt === "") return false;
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return false;
  return Date.now() >= expiryMs - EXPIRY_SKEW_MS;
}

async function postToken(form: Record<string, string>): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (err) {
    throw new CliExitError(
      `failed to reach the authentication server: ${(err as Error).message}`,
      ExitCode.Connection,
    );
  }

  const body = (await response.json().catch(() => ({}))) as Auth0TokenResponse;
  if (!response.ok || body.access_token === undefined) {
    const detail = body.error_description ?? body.error ?? `HTTP ${response.status}`;
    throw new CliExitError(`authentication failed: ${detail}`, ExitCode.Auth);
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt:
      body.expires_in !== undefined
        ? new Date(Date.now() + body.expires_in * 1000).toISOString()
        : undefined,
  };
}
