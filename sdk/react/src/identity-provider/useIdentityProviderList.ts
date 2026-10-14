"use client";

import { create } from "@bufbuild/protobuf";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { ListIdentityProvidersInputSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX, readEveryPage } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useIdentityProviderList}. */
export interface UseIdentityProviderListReturn {
  /** All identity providers for the organization. Empty while loading or on error. */
  readonly identityProviders: readonly IdentityProvider[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all identity providers for an organization.
 *
 * Identity providers are admin-level resources with small cardinality
 * (typically 1–3 per org), and the members page looks a provider up among
 * them, so the hook walks every page of the list and answers the whole
 * set.
 *
 * Pass `null` to skip fetching (stable no-op). Call `refetch()` to
 * re-query after mutations (create / update / delete).
 *
 * @example
 * ```tsx
 * function IdpSettings({ org }: { org: string }) {
 *   const { identityProviders, isLoading, error } = useIdentityProviderList(org);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *
 *   return (
 *     <ul>
 *       {identityProviders.map((idp) => (
 *         <li key={idp.metadata?.id}>{idp.metadata?.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until org is known
 * const { identityProviders } = useIdentityProviderList(org ?? null);
 * ```
 */
export function useIdentityProviderList(
  org: string | null,
): UseIdentityProviderListReturn {
  const stigmer = useStigmer();

  const { data: identityProviders, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          readEveryPage((pageToken) =>
            stigmer.identityProvider.list(
              create(ListIdentityProvidersInputSchema, { org, pageSize: LIST_PAGE_MAX, pageToken }),
            ),
          )
      : null,
    [org, stigmer],
    [] as IdentityProvider[],
  );

  return { identityProviders, isLoading, isRefetching, error, refetch };
}
