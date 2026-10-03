"use client";

import { create } from "@bufbuild/protobuf";
import { GetPrincipalsCountInputSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

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
 * Wraps `iamPolicy.getPrincipalsCount()`: every principal of the kind
 * that holds a role on the organization. For identity accounts that
 * includes the accounts a PlatformClient provisioned for the
 * organization's own product and any machine account granted a role, so
 * it is the size of the access list, not the number of the
 * organization's people. A member count reads the organization's access
 * list ({@link useResourceAccess}) and leaves out the entries
 * `isPlatformClientAccount` (from `@stigmer/sdk`) marks, as
 * `OrgMembersPanel` does.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @param org         - Organization ID, or `null` to skip.
 * @param principalKind - Kind of principals to count. Defaults to `"identity_account"`.
 *
 * @example
 * ```tsx
 * const { count, isLoading } = usePrincipalsCount(org);
 * // count = 5
 * ```
 */
export function usePrincipalsCount(
  org: string | null,
  principalKind: string = "identity_account",
): UsePrincipalsCountReturn {
  const stigmer = useStigmer();

  const { data: count, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          stigmer.iamPolicy
            .getPrincipalsCount(
              create(GetPrincipalsCountInputSchema, { org, principalKind }),
            )
            .then((r) => r.count)
      : null,
    [org, principalKind, stigmer],
    0,
  );

  return { count, isLoading, isRefetching, error, refetch };
}
