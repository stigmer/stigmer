"use client";

import type {
  CustomerModelPricingResponse,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useCustomerModelPricing}. */
export interface UseCustomerModelPricingReturn {
  /** The pricing response, or `null` before the first successful fetch. */
  readonly pricing: CustomerModelPricingResponse | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the customer-facing model price list.
 *
 * Returns per-million-token prices for all billable models with
 * billing policy markup already applied, organized by harness
 * and cost tier.
 *
 * Pass `null` as `orgId` to skip fetching (stable no-op).
 * Pass `undefined` to fetch default pricing (no org override).
 *
 * @param orgId - Organization ID for org-specific overrides,
 *   `undefined` for default pricing, or `null` to skip.
 *
 * @example
 * ```tsx
 * const { pricing, isLoading } = useCustomerModelPricing(orgId);
 *
 * if (isLoading) return <Skeleton />;
 * if (!pricing) return null;
 *
 * return pricing.entries.map(entry => (
 *   <PricingRow key={entry.modelId} entry={entry} />
 * ));
 * ```
 */
export function useCustomerModelPricing(
  orgId: string | undefined | null,
): UseCustomerModelPricingReturn {
  const stigmer = useStigmer();

  const skip = orgId === null;

  const { data: pricing, isLoading, isRefetching, error, refetch } = useFetch(
    skip
      ? null
      : () =>
          stigmer.billing.getCustomerModelPricing(
            orgId ? { orgId } : undefined,
          ),
    [orgId, stigmer],
    null as CustomerModelPricingResponse | null,
  );

  return { pricing, isLoading, isRefetching, error, refetch };
}
