// Keeping a sign-in fresh: refresh an expired access token at the provider
// that issued it, and expose token providers that refresh silently.
//
// A signed-in entry (a `cloud` or `selfhost` backend that `stigmer auth login`
// wrote) keeps its token set beside the issuer and the native client it came
// from (`oidc_issuer`, `oidc_client_id`); a refresh reads that issuer's token
// endpoint from its discovery document and sends that client's id, so every
// server's sign-in refreshes the same way. An entry with no issuer (written by
// a CLI from before servers announced their sign-in) is not refreshed: the
// server refuses its stale token and the person is told to sign in again.
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
  hasSignIn,
  load,
  save,
} from "../config/index.js";
import { DEFAULT_CLOUD_ENDPOINT } from "../config/resolve.js";
import { CliExitError, ExitCode } from "../errors/index.js";
import { discover, postTokenForm, type TokenSet } from "./oidc.js";

export type { TokenSet } from "./oidc.js";

// Refresh this many ms before the real expiry so an in-flight request never
// races the token going stale.
const EXPIRY_SKEW_MS = 60_000;

// How long a long-running source keeps a token stored with no usable expiry (a
// pasted token) before reading the file again, so a later `stigmer auth login`
// is picked up without a restart. Shorter reads the disk more often; longer
// picks up a new sign-in later.
const NO_EXPIRY_REREAD_MS = 5 * 60_000;

/**
 * Exchange a refresh token for a fresh access token at the provider the entry
 * signed in with. An entry that names no provider cannot be refreshed.
 */
export async function refreshAccessToken(entry: NamedBackendConfig, refreshToken: string): Promise<TokenSet> {
  const issuer = entry.oidc_issuer;
  const clientId = entry.oidc_client_id;
  if (issuer === undefined || issuer === "" || clientId === undefined || clientId === "") {
    throw new CliExitError("this sign-in names no provider to refresh it at", ExitCode.Auth, [
      "Sign in again:  stigmer auth login",
    ]);
  }
  const { tokenEndpoint } = await discover(issuer);
  return postTokenForm(tokenEndpoint, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  });
}

/** Whether a long-running source may serve this entry's sign-in. */
function servesSignIn(entry: NamedBackendConfig | undefined, endpoint: string): entry is NamedBackendConfig {
  if (entry === undefined || cloudEndpoint(entry) !== endpoint) return false;
  return entry.type === "cloud" || hasSignIn(entry);
}

/**
 * A token provider for the backend client that keeps the access token fresh.
 *
 * Precedence and behavior, evaluated per request against the ACTIVE named
 * backend:
 *   1. STIGMER_API_KEY (env / bridged --api-key) wins and is never refreshed.
 *   2. A selfhost backend with no sign-in returns its stored api_key (no
 *      refresh machinery — server-minted `stk_` tokens are opaque and live
 *      until deleted or expired server-side); local returns null (no auth).
 *   3. A signed-in backend's (any cloud backend, or a selfhost one `stigmer
 *      auth login` signed in to) non-expired access token is returned as-is.
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
    if (entry.type === "selfhost" && !hasSignIn(entry)) return entry.api_key ?? null;

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
 * address: the signed-in backend `backendName` at `endpoint`, as they were
 * when it started. Built on the SDK's token cache, so a token is kept until a
 * minute before it expires, concurrent calls share one fetch, and a failed
 * fetch is not kept. Each fetch:
 *   1. reads the config file as it is now, so it sees a refresh, a rotated
 *      refresh token or a login another command saved;
 *   2. answers null (no credential, never another backend's) when the entry
 *      is gone, no longer holds a sign-in (a selfhost entry signed out), or
 *      now points elsewhere;
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
    if (!servesSignIn(entry, endpoint)) return null;
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

/** The address an entry is dialed at: its own, else (a cloud entry) Stigmer Cloud's. */
function cloudEndpoint(entry: NamedBackendConfig): string {
  return entry.endpoint !== undefined && entry.endpoint !== ""
    ? entry.endpoint
    : DEFAULT_CLOUD_ENDPOINT;
}

/** A signed-in entry's access token and its stored expiry, if any. */
interface CloudToken {
  readonly accessToken: string;
  readonly expiresAt: string | undefined;
}

/**
 * The entry's access token, refreshed first when it is missing or
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
    next = await refreshAccessToken(entry, entry.refresh_token);
  } catch {
    return current;
  }
  applyTokenSet(entry, next);
  persist(next);
  return { accessToken: next.accessToken, expiresAt: next.expiresAt };
}

/**
 * Write a refreshed token set into the file as it is on disk now, patching
 * only the token fields of `backendName`, and only while that entry still
 * holds a sign-in for `endpoint`: a backend removed, signed out or re-pointed
 * meanwhile is left as the person left it.
 */
function persistRefreshedTokens(backendName: string, endpoint: string, next: TokenSet): void {
  const config = load();
  const entry = config.backends?.[backendName];
  if (!servesSignIn(entry, endpoint)) return;
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
