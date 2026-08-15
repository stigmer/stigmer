"use client";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

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
 * Cloud-only by nature: the OSS local server does not implement
 * IdentityAccount. Gate consumers with
 * `useResourceAvailable(ApiResourceKind.identity_account)`.
 *
 * @example
 * ```tsx
 * const { account, refetch } = useMyIdentityAccount();
 * const standingContext =
 *   account?.spec?.preferences?.standingContext ?? "";
 * ```
 */
export function useMyIdentityAccount(): UseMyIdentityAccountReturn {
  const stigmer = useStigmer();

  const { data: account, isLoading, isRefetching, error, refetch } = useFetch(
    () => stigmer.identityAccount.whoAmI(),
    [stigmer],
    null as IdentityAccount | null,
  );

  return { account, isLoading, isRefetching, error, refetch };
}
