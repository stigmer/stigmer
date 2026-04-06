"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { GetPrincipalsCountInputSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link usePrincipalsCount}. */
export interface UsePrincipalsCountReturn {
  /** Number of distinct principals with access. `0` while loading. */
  readonly count: number;
  /** `true` while the fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the count from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the count of principals with access to an
 * organization.
 *
 * Wraps `iamPolicy.getPrincipalsCount()`. Useful for member count
 * badges in navigation and summary statistics.
 *
 * Pass `null` as `orgId` to skip fetching (stable no-op).
 *
 * @param orgId         - Organization ID, or `null` to skip.
 * @param principalKind - Kind of principals to count. Defaults to `"identity_account"`.
 *
 * @example
 * ```tsx
 * const { count, isLoading } = usePrincipalsCount(orgId);
 * // count = 5
 * ```
 */
export function usePrincipalsCount(
  orgId: string | null,
  principalKind: string = "identity_account",
): UsePrincipalsCountReturn {
  const stigmer = useStigmer();
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(!!orgId);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const [prevOrgId, setPrevOrgId] = useState(orgId);
  if (orgId !== prevOrgId) {
    setPrevOrgId(orgId);
    if (orgId) {
      setIsLoading(true);
      setCount(0);
      setError(null);
    } else {
      setIsLoading(false);
      setCount(0);
      setError(null);
    }
  }

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!orgId) return;

    const cancelled = { current: false };

    stigmer.iamPolicy
      .getPrincipalsCount(
        create(GetPrincipalsCountInputSchema, {
          orgId,
          principalKind,
        }),
      )
      .then(
        (result) => {
          if (cancelled.current) return;
          setCount(result.count);
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
  }, [orgId, principalKind, stigmer, fetchKey]);

  return { count, isLoading, error, refetch };
}
