"use client";

import { useEffect, useRef, useState } from "react";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useWhoAmI}. */
export interface UseWhoAmIReturn {
  /** The authenticated user's identity account, or `null` while loading / on error. */
  readonly account: IdentityAccount | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the failed request, or `null` when healthy. */
  readonly error: Error | null;
}

/** Options for {@link useWhoAmI}. */
export interface UseWhoAmIOptions {
  /**
   * `false` holds the hook idle: no request, `account` stays `null`. A
   * surface that needs the caller only in some states (a guest token
   * cannot make this read) keeps the hook mounted and switches it here.
   *
   * @default true
   */
  readonly enabled?: boolean;
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
export function useWhoAmI(options?: UseWhoAmIOptions): UseWhoAmIReturn {
  const enabled = options?.enabled ?? true;
  const stigmer = useStigmer();
  const [account, setAccount] = useState<IdentityAccount | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  const cacheRef = useRef<{
    client: typeof stigmer;
    account: IdentityAccount | null;
  } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
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
  }, [stigmer, enabled]);

  return { account, isLoading, error };
}
