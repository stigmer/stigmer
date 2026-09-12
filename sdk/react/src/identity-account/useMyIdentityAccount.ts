"use client";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link useMyIdentityAccount}. */
export interface UseMyIdentityAccountOptions {
  /**
   * When `false`, the hook is idle: no RPC is issued and `account` stays
   * `null`. Lets always-called hooks (React's rules) stay silent on a
   * surface that must not fetch identity — the guest and embed audiences,
   * or a caller who has not signed in yet.
   *
   * @default true
   */
  readonly enabled?: boolean;
}

/** Return value of {@link useMyIdentityAccount}. */
export interface UseMyIdentityAccountReturn {
  /** The authenticated user's identity account, or `null` while loading / on error. */
  readonly account: IdentityAccount | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the account from the server (e.g. after an update). */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the current authenticated user's full
 * {@link IdentityAccount} via `identityAccount.whoAmI()`.
 *
 * Unlike {@link useWhoAmI} (a cached identity lookup for "is this me?"
 * checks), this hook is a refetchable data source for editors of the
 * caller's own account — after a mutation, call `refetch()` to re-sync.
 * `whoAmI()` returns the complete resource, so no follow-up `get()` is
 * needed.
 *
 * Served by every edition: on Stigmer Cloud and an authenticated self-host
 * the account is the signed-in user's; on a trusted-local server it is the
 * operator account the server creates at boot. A caller with no account yet
 * gets NOT_FOUND — the first-sign-in flow (`ensureMyIdentityAccount`, run by
 * {@link useIdentityAccountGate} and the CLI) is what creates one.
 *
 * Cached across mounts under a {@link FetchCacheProvider} (DD-014): a
 * revisit renders the previous result immediately and refetches in the
 * background, so consumers that seed UI from the account (e.g. composer
 * defaults) settle synchronously after the first visit.
 *
 * @example
 * ```tsx
 * const { account, refetch } = useMyIdentityAccount();
 * const standingContext =
 *   account?.spec?.preferences?.standingContext ?? "";
 * ```
 */
export function useMyIdentityAccount(
  options?: UseMyIdentityAccountOptions,
): UseMyIdentityAccountReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;

  const { data: account, isLoading, isRefetching, error, refetch } = useFetch(
    enabled ? () => stigmer.identityAccount.whoAmI() : null,
    [stigmer, enabled],
    null as IdentityAccount | null,
    { cacheKey: enabled ? "identity-account:me" : undefined },
  );

  return { account, isLoading, isRefetching, error, refetch };
}
