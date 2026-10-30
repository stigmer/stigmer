"use client";

import { create } from "@bufbuild/protobuf";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { ListFederationIssuersInputSchema } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { LIST_PAGE_MAX, readEveryPage } from "@stigmer/react-core/internal";
import { useFetch } from "@stigmer/react-core/internal";

/** Return value of {@link useFederationIssuerList}. */
export interface UseFederationIssuerListReturn {
  /** All federation issuers for the organization. Empty while loading or on error. */
  readonly federationIssuers: readonly FederationIssuer[];
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
 * Data hook that fetches all federation issuers for an organization.
 *
 * Federation issuers are admin-level resources with small cardinality
 * (typically 1–3 per org), and the members page looks an issuer up among
 * them, so the hook walks every page of the list and answers the whole
 * set.
 *
 * Pass `null` to skip fetching (stable no-op). Call `refetch()` to
 * re-query after mutations (create / update / delete).
 *
 * @example
 * ```tsx
 * function IssuerSettings({ org }: { org: string }) {
 *   const { federationIssuers, isLoading, error } = useFederationIssuerList(org);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *
 *   return (
 *     <ul>
 *       {federationIssuers.map((issuer) => (
 *         <li key={issuer.metadata?.id}>{issuer.metadata?.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until org is known
 * const { federationIssuers } = useFederationIssuerList(org ?? null);
 * ```
 */
export function useFederationIssuerList(
  org: string | null,
): UseFederationIssuerListReturn {
  const stigmer = useStigmer();

  const { data: federationIssuers, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          readEveryPage((pageToken) =>
            stigmer.federationIssuer.list(
              create(ListFederationIssuersInputSchema, { org, pageSize: LIST_PAGE_MAX, pageToken }),
            ),
          )
      : null,
    [org, stigmer],
    [] as FederationIssuer[],
  );

  return { federationIssuers, isLoading, isRefetching, error, refetch };
}
