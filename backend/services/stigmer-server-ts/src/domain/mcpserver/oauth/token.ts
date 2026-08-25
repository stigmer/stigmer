/**
 * OAuth token-endpoint client — ports pkg/domain/mcpserver/oauth/token.go
 * whole: the pre-flight refresh (#17) and the authorization-code exchange
 * (#19). Proven by mcpserver-oauth.conformance.test.ts and the Class B
 * mcpserver-connect suite.
 */
import { truncateBody } from "./truncate-body.js";

/** Token-endpoint response (Go TokenResponse). */
export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  scope: string;
}

/**
 * Token-endpoint client authentication methods, in the RFC 8414
 * token_endpoint_auth_methods_supported vocabulary. An empty or
 * unrecognized method falls back to Basic — the RFC 6749 §2.3.1 baseline.
 */
export const TOKEN_AUTH_METHOD_BASIC = "client_secret_basic";
export const TOKEN_AUTH_METHOD_POST = "client_secret_post";

/** Go's tokenHTTPClient 15s timeout — a named constant per guidelines. */
export const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Exchanges an authorization code for tokens using the
 * authorization_code grant with PKCE (Go ExchangeCode). For public
 * clients (DCR), clientSecret is empty; for confidential clients (vendor
 * OAuth) tokenAuthMethod selects how the secret is presented.
 */
export async function exchangeCode(
  tokenEndpoint: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
  clientSecret: string,
  tokenAuthMethod: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId,
  });
  return doTokenRequest(
    tokenEndpoint,
    params,
    clientId,
    clientSecret,
    tokenAuthMethod,
    fetchImpl,
  );
}

/**
 * Exchanges a refresh token for a new access token (refresh_token
 * grant). For public clients (DCR), clientSecret is empty; for
 * confidential clients (vendor OAuth) tokenAuthMethod selects how the
 * secret is presented.
 */
export async function refreshToken(
  tokenEndpoint: string,
  currentRefreshToken: string,
  clientId: string,
  clientSecret: string,
  tokenAuthMethod: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: currentRefreshToken,
    client_id: clientId,
  });
  return doTokenRequest(
    tokenEndpoint,
    params,
    clientId,
    clientSecret,
    tokenAuthMethod,
    fetchImpl,
  );
}

async function doTokenRequest(
  tokenEndpoint: string,
  params: URLSearchParams,
  clientId: string,
  clientSecret: string,
  tokenAuthMethod: string,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  // Exactly one credential channel per request — RFC 6749 §2.3 forbids
  // presenting the secret through more than one method. Post mode rides
  // the form body; anything else (including empty) is the Basic-header
  // baseline.
  const usePostSecret =
    clientSecret !== "" && tokenAuthMethod === TOKEN_AUTH_METHOD_POST;
  if (usePostSecret) {
    params.set("client_secret", clientSecret);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (clientSecret !== "" && !usePostSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers,
      body: params.toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `token request to ${tokenEndpoint} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(
      `token endpoint ${tokenEndpoint} returned HTTP ${response.status}: ${truncateBody(body)}`,
    );
  }

  let raw: {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    authed_user?: {
      access_token?: string;
      token_type?: string;
      scope?: string;
    };
  };
  try {
    raw = JSON.parse(body) as typeof raw;
  } catch (error) {
    throw new Error(
      `failed to parse token response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const tokenResponse: TokenResponse = {
    accessToken: raw.access_token ?? "",
    tokenType: raw.token_type ?? "",
    expiresIn: raw.expires_in ?? 0,
    refreshToken: raw.refresh_token ?? "",
    scope: raw.scope ?? "",
  };

  // Slack V2 nests user tokens under authed_user when only user scopes
  // are requested; its presence is the reliable signal to prefer the user
  // token over the top-level bot token. Standard providers omit it.
  if (raw.authed_user !== undefined) {
    if ((raw.authed_user.access_token ?? "") !== "") {
      tokenResponse.accessToken = raw.authed_user.access_token as string;
    }
    if ((raw.authed_user.token_type ?? "") !== "") {
      tokenResponse.tokenType = raw.authed_user.token_type as string;
    }
    if ((raw.authed_user.scope ?? "") !== "") {
      tokenResponse.scope = raw.authed_user.scope as string;
    }
  }

  if (tokenResponse.accessToken === "") {
    throw new Error(
      `token response from ${tokenEndpoint} is missing access_token`,
    );
  }
  return tokenResponse;
}
