// Auth0 token operations: exchange an authorization code for tokens, refresh an
// expired access token, and expose token providers that refresh silently.
//
// Two providers share one refresh path (freshCloudToken), so they cannot drift:
//   - createRefreshingTokenProvider serves a short-lived command. It reads the
//     ACTIVE backend from the config the command loaded, and concurrent calls
//     (a command's Promise.all of RPCs) share one refresh.
//   - createBackendTokenSource serves a long-running process (`stigmer
//     mcp-server`). Its server dials one fixed address, so the source is pinned
//     to the backend it started with and never follows `config backend use`
//     elsewhere; it re-reads the file once per token lifetime so it sees a
//     refresh or a login another command wrote.
//
// A refresh is persisted by patching only that entry's token fields into the
// file as it is on disk now, never by saving a config loaded earlier, so it
// cannot undo a `backend use` or a login another command saved meanwhile.

import { createTokenCache, type TokenCache, type TokenProvider } from "@stigmer/client";
import {
  type Config,
  type NamedBackendConfig,
  activeBackend,
  load,
  save,
} from "../config/index.js";
import { DEFAULT_CLOUD_ENDPOINT } from "../config/resolve.js";
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

// How long a long-running source keeps a token stored with no usable expiry (a
// pasted token) before reading the file again, so a later `stigmer auth login`
// is picked up without a restart. Shorter reads the disk more often; longer
// picks up a new sign-in later.
const NO_EXPIRY_REREAD_MS = 5 * 60_000;

interface Auth0TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchange a PKCE authorization code for an access (+refresh) token. */
export async function exchangeCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<TokenSet> {
  return postToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: params.code,
    redirect_uri: callbackUrl(),
    code_verifier: params.codeVerifier,
  });
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenSet> {
  return postToken({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
}

/**
 * A token provider for the backend client that keeps the access token fresh.
 *
 * Precedence and behavior, evaluated per request against the ACTIVE named
 * backend:
 *   1. STIGMER_API_KEY (env / bridged --api-key) wins and is never refreshed.
 *   2. selfhost backends return their stored api_key (no refresh machinery —
 *      server-minted `stk_` tokens are opaque and live until deleted or
 *      expired server-side); local returns null (no auth).
 *   3. A cloud backend's non-expired access token is returned as-is.
 *   4. An expired token with a refresh token is refreshed; the new token,
 *      rotated refresh token, and expiry are set INTO THE ENTRY and patched
 *      into that entry on disk, then returned. Calls made while a refresh is
 *      in flight share it, so a burst of RPCs makes one refresh request.
 *   5. Otherwise the (possibly stale) token or null is returned, letting the
 *      server reject it so the error maps to a clear "please log in" exit.
 *
 * Closes over `config` so a refresh updates the same object the rest of the
 * command sees.
 */
export function createRefreshingTokenProvider(config: Config): TokenProvider {
  let inFlight:
    | { readonly entry: NamedBackendConfig; readonly token: Promise<string | null> }
    | undefined;
  return async (): Promise<string | null> => {
    const envKey = process.env.STIGMER_API_KEY;
    if (envKey !== undefined && envKey !== "") return envKey;

    const { name, entry } = activeBackend(config);
    if (entry === undefined) return null;
    if (entry.type === "selfhost") return entry.api_key ?? null;

    if (inFlight?.entry !== entry) {
      const endpoint = cloudEndpoint(entry);
      const token = freshCloudToken(entry, (next) =>
        persistRefreshedTokens(name, endpoint, next),
      ).then((fresh) => fresh?.accessToken ?? null);
      inFlight = { entry, token };
      const settled = (): void => {
        if (inFlight?.token === token) inFlight = undefined;
      };
      token.then(settled, settled);
    }
    return inFlight.token;
  };
}

/**
 * The token source for a long-running process whose server dials one fixed
 * address: the cloud backend `backendName` at `endpoint`, as they were when
 * it started. Built on the SDK's token cache, so a token is kept until a
 * minute before it expires, concurrent calls share one fetch, and a failed
 * fetch is not kept. Each fetch:
 *   1. reads the config file as it is now, so it sees a refresh, a rotated
 *      refresh token or a login another command saved;
 *   2. answers null (no credential, never another backend's) when the entry
 *      is gone, is no longer a cloud backend, or now points elsewhere;
 *   3. otherwise refreshes the token when it is expired, persisting it as the
 *      short-lived provider does;
 *   4. keeps a token with no usable expiry for {@link NO_EXPIRY_REREAD_MS}.
 * A dead sign-in (the refresh refused) answers the stale token with its past
 * expiry, so the next call reads the file again and a `stigmer auth login` in
 * another terminal takes effect on it.
 *
 * `STIGMER_API_KEY` is not consulted: a given key is used instead of this
 * source, never through it.
 */
export function createBackendTokenSource(backendName: string, endpoint: string): TokenCache {
  return createTokenCache(async () => {
    const entry = load().backends?.[backendName];
    if (entry === undefined || entry.type !== "cloud" || cloudEndpoint(entry) !== endpoint) {
      return null;
    }
    const fresh = await freshCloudToken(entry, (next) =>
      persistRefreshedTokens(backendName, endpoint, next),
    );
    if (fresh === null) return null;
    const expiresAtMs = Date.parse(fresh.expiresAt ?? "");
    return {
      accessToken: fresh.accessToken,
      expiresAt: Number.isNaN(expiresAtMs) ? Date.now() + NO_EXPIRY_REREAD_MS : expiresAtMs,
    };
  });
}

/** The address a cloud entry is dialed at: its own, else Stigmer Cloud's. */
function cloudEndpoint(entry: NamedBackendConfig): string {
  return entry.endpoint !== undefined && entry.endpoint !== ""
    ? entry.endpoint
    : DEFAULT_CLOUD_ENDPOINT;
}

/** A cloud entry's access token and its stored expiry, if any. */
interface CloudToken {
  readonly accessToken: string;
  readonly expiresAt: string | undefined;
}

/**
 * The cloud entry's access token, refreshed first when it is missing or
 * expired and a refresh token is stored. A refresh sets the new token set into
 * `entry` and hands it to `persist`. A refused refresh (a revoked or expired
 * sign-in) answers the current token, if any: the server rejects it and the
 * person is told to sign in again.
 */
async function freshCloudToken(
  entry: NamedBackendConfig,
  persist: (next: TokenSet) => void,
): Promise<CloudToken | null> {
  const current =
    entry.token === undefined || entry.token === ""
      ? null
      : { accessToken: entry.token, expiresAt: entry.token_expiry };
  if (current !== null && !isExpired(entry.token_expiry)) return current;
  if (entry.refresh_token === undefined || entry.refresh_token === "") return current;

  let next: TokenSet;
  try {
    next = await refreshAccessToken(entry.refresh_token);
  } catch {
    return current;
  }
  applyTokenSet(entry, next);
  persist(next);
  return { accessToken: next.accessToken, expiresAt: next.expiresAt };
}

/**
 * Write a refreshed token set into the file as it is on disk now, patching
 * only the token fields of `backendName`, and only while that entry is still
 * the cloud backend at `endpoint`: a backend removed or re-pointed meanwhile
 * is left as the person left it.
 */
function persistRefreshedTokens(backendName: string, endpoint: string, next: TokenSet): void {
  const config = load();
  const entry = config.backends?.[backendName];
  if (entry === undefined || entry.type !== "cloud" || cloudEndpoint(entry) !== endpoint) return;
  applyTokenSet(entry, next);
  save(config);
}

function applyTokenSet(entry: NamedBackendConfig, next: TokenSet): void {
  entry.token = next.accessToken;
  if (next.refreshToken !== undefined) entry.refresh_token = next.refreshToken;
  entry.token_expiry = next.expiresAt;
}

function isExpired(expiresAt: string | undefined): boolean {
  // A token stored without an expiry (a pasted token or key carries none) is
  // assumed valid; the server is the ultimate authority and a 401 triggers
  // re-login.
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
    const detail =
      body.error_description ?? body.error ?? `HTTP ${response.status}`;
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
