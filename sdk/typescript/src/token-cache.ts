import { createExpiringTokenCache } from "./internal/expiring-token.js";

/**
 * What a token fetch returns: the token and when it expires.
 *
 * `expiresAt` takes the shapes a backend usually sends: a `Date`, an
 * ISO 8601 string (what `JSON.stringify` makes of a `Date`), or epoch
 * milliseconds. It is the shape `stigmer.tokens.mintUserToken` answers
 * with, once it has crossed the wire as JSON.
 */
export interface FetchedToken {
  readonly accessToken: string;
  readonly expiresAt: Date | string | number;
}

/**
 * A token provider that fetches once and reuses the token until it is
 * about to expire. Pass {@link TokenCache.getAccessToken} to a
 * `Stigmer` client.
 */
export interface TokenCache {
  /**
   * Token provider for `StigmerConfig.getAccessToken`. Serves the cached
   * token until a minute before it expires, then fetches a new one;
   * callers that ask while a fetch is in flight share it. A rejected
   * fetch is not cached, so the next request tries again.
   *
   * Defined as a property so it can be passed detached:
   * `new Stigmer({ ..., getAccessToken: tokens.getAccessToken })`.
   */
  readonly getAccessToken: () => Promise<string | null>;
  /**
   * Forgets the cached token. Call it when your own user signs out or
   * changes, so a token minted for one person is never sent for the
   * next.
   */
  readonly invalidate: () => void;
}

/**
 * Create a token provider that asks your backend for a token once and
 * keeps it until it is about to expire, instead of on every request.
 *
 * `fetchToken` returns `{ accessToken, expiresAt }`, or `null` when
 * nobody is signed in (the request is then sent without a token, and
 * nothing is cached).
 *
 * @example
 * ```typescript
 * import { Stigmer, createTokenCache } from "@stigmer/client";
 *
 * const tokens = createTokenCache(async () => {
 *   const res = await fetch("/api/stigmer-token");
 *   return res.json(); // { accessToken, expiresAt }
 * });
 *
 * const stigmer = new Stigmer({
 *   baseUrl: "https://api.stigmer.ai",
 *   getAccessToken: tokens.getAccessToken,
 * });
 *
 * // When your user signs out:
 * tokens.invalidate();
 * ```
 *
 * @throws {Error} from `getAccessToken` when a fetched `expiresAt` is
 *   not a date
 */
export function createTokenCache(
  fetchToken: () => Promise<FetchedToken | null>,
): TokenCache {
  const cache = createExpiringTokenCache(async () => {
    const token = await fetchToken();
    if (!token) return null;
    return {
      accessToken: token.accessToken,
      expiresAtMs: toEpochMs(token.expiresAt),
    };
  });
  return {
    getAccessToken: () => cache.get(),
    invalidate: () => cache.invalidate(),
  };
}

function toEpochMs(expiresAt: Date | string | number): number {
  const ms =
    expiresAt instanceof Date
      ? expiresAt.getTime()
      : typeof expiresAt === "number"
        ? expiresAt
        : Date.parse(expiresAt);
  if (!Number.isFinite(ms)) {
    throw new Error(
      `createTokenCache: the fetched token's expiresAt (${String(expiresAt)}) is not a date; return a Date, an ISO 8601 string or epoch milliseconds`,
    );
  }
  return ms;
}
