"use client";

import { useEffect, useState } from "react";
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
  // The answer, kept with the client that gave it: an answer from another
  // client is no answer, and a held hook shows none. Loading is derived, so
  // the first render after the hook is switched on already says so.
  const [answer, setAnswer] = useState<{
    readonly client: typeof stigmer;
    readonly account: IdentityAccount | null;
    readonly error: Error | null;
  } | null>(null);
  const answered = answer !== null && answer.client === stigmer;

  useEffect(() => {
    if (!enabled) return;
    if (answer !== null && answer.client === stigmer && answer.account !== null) return;
    if (answer !== null) setAnswer(null);

    const cancelled = { current: false };

    stigmer.identityAccount
      .whoAmI()
      .then(
        (result) => {
          if (cancelled.current) return;
          setAnswer({ client: stigmer, account: result, error: null });
        },
        (err) => {
          if (cancelled.current) return;
          setAnswer({ client: stigmer, account: null, error: toError(err) });
        },
      );

    return () => {
      cancelled.current = true;
    };
    // The answer is read to skip a client already answered, never to
    // refetch when it lands.
  }, [stigmer, enabled]);

  if (!enabled) return { account: null, isLoading: false, error: null };
  return {
    account: answered ? answer.account : null,
    isLoading: !answered,
    error: answered ? answer.error : null,
  };
}
