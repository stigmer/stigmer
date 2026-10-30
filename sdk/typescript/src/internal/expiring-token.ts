/**
 * One cached bearer token that expires, shared by the guest helper
 * (`guest-auth.ts`) and the public `createTokenCache` (`token-cache.ts`),
 * so the two cannot drift.
 *
 * The client calls its token provider once per request. This keeps one
 * token in memory until it is close to expiry, and collapses the burst
 * of calls at page load into one fetch.
 */

/**
 * How long before expiry a cached token counts as stale. Fetching again
 * inside this window keeps a long-lived stream from starting with a
 * token that expires moments later.
 */
export const EXPIRY_SKEW_MS = 60_000;

/** A token and the moment it expires, in epoch milliseconds. */
export interface ExpiringToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/** The cache's two operations. */
export interface ExpiringTokenCache {
  /**
   * The cached token while it has more than {@link EXPIRY_SKEW_MS} of
   * life left; otherwise the result of a new fetch, shared by every
   * caller that asks while it is in flight. A `null` fetch result
   * (nobody signed in) and a rejected fetch are not cached, so the next
   * call fetches again.
   */
  get(): Promise<string | null>;
  /**
   * Forgets the cached token. A fetch already in flight still answers
   * the callers waiting on it, but its token is not kept: a token
   * minted for one person must not be served after the host says that
   * person signed out or changed.
   */
  invalidate(): void;
}

/** Creates the cache over a fetch that returns a token or `null`. */
export function createExpiringTokenCache(
  fetchToken: () => Promise<ExpiringToken | null>,
): ExpiringTokenCache {
  let cached: ExpiringToken | null = null;
  let pending: Promise<string | null> | null = null;
  // Bumped by invalidate, so a fetch that started before it is not cached.
  let generation = 0;

  const fetchAndKeep = async (): Promise<string | null> => {
    const startedIn = generation;
    try {
      const token = await fetchToken();
      if (token && startedIn === generation) cached = token;
      return token ? token.accessToken : null;
    } finally {
      if (startedIn === generation) pending = null;
    }
  };

  return {
    get() {
      if (cached && cached.expiresAtMs - Date.now() > EXPIRY_SKEW_MS) {
        return Promise.resolve(cached.accessToken);
      }
      pending ??= fetchAndKeep();
      return pending;
    },
    invalidate() {
      // Stryker disable next-line AssignmentOperator: the generation only has to change, and `-=` changes it as surely as `+=`
      generation += 1;
      cached = null;
      pending = null;
    },
  };
}
