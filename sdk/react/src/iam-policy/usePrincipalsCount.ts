"use client";

import { create } from "@bufbuild/protobuf";
import { GetPrincipalsCountInputSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link usePrincipalsCount}. */
export interface UsePrincipalsCountReturn {
  /** Number of distinct principals with access. `0` while loading. */
  readonly count: number;
  /** `true` while the fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
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

  const { data: count, isLoading, isRefetching, error, refetch } = useFetch(
    orgId
      ? () =>
          stigmer.iamPolicy
            .getPrincipalsCount(
              create(GetPrincipalsCountInputSchema, { orgId, principalKind }),
            )
            .then((r) => r.count)
      : null,
    [orgId, principalKind, stigmer],
    0,
  );

  return { count, isLoading, isRefetching, error, refetch };
}
