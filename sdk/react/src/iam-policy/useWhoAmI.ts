"use client";

import { useEffect, useRef, useState } from "react";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useWhoAmI}. */
export interface UseWhoAmIReturn {
  /** The authenticated user's identity account, or `null` while loading / on error. */
  readonly account: IdentityAccount | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the failed request, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Data hook that fetches the current authenticated user's
 * {@link IdentityAccount} via `identityAccount.whoAmI()`.
 *
 * The result is cached for the lifetime of the `Stigmer` client
 * instance — subsequent mounts and re-renders reuse the cached
 * value without additional network calls.
 *
 * Useful for self-protection in access management UIs (disabling
 * "remove" or "change role" on the current user) and displaying
 * a "You" indicator.
 *
 * @example
 * ```tsx
 * const { account } = useWhoAmI();
 * const myId = account?.metadata?.id;
 * ```
 */
export function useWhoAmI(): UseWhoAmIReturn {
  const stigmer = useStigmer();
  const [account, setAccount] = useState<IdentityAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const cacheRef = useRef<{
    client: typeof stigmer;
    account: IdentityAccount | null;
  } | null>(null);

  useEffect(() => {
    if (cacheRef.current?.client === stigmer && cacheRef.current.account) {
      setAccount(cacheRef.current.account);
      setIsLoading(false);
      return;
    }

    const cancelled = { current: false };

    stigmer.identityAccount
      .whoAmI()
      .then(
        (result) => {
          if (cancelled.current) return;
          cacheRef.current = { client: stigmer, account: result };
          setAccount(result);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [stigmer]);

  return { account, isLoading, error };
}
