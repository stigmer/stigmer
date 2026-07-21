"use client";

import type {
  ModelPricingGovernanceResponse,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link usePricingGovernance}. */
export interface UsePricingGovernanceReturn {
  /** The governance view, or `null` before the first successful fetch. */
  readonly governance: ModelPricingGovernanceResponse | null;
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
 * Data hook that fetches the platform pricing governance view: every
 * model's baseline vs effective rates, the ACTIVE pricing overrides
 * composed into them (with full ledger provenance), and the
 * PENDING_SIGNOFF proposals awaiting an operator decision.
 *
 * Platform-operator surface: the caller needs `can_manage_model_pricing`
 * on `platform:stigmer`, and the rates are raw provider prices
 * (pre-markup) — never render them as customer prices.
 *
 * Pass `enabled: false` to skip fetching (stable no-op) — e.g. while the
 * caller's operator capability is still resolving.
 *
 * @example
 * ```tsx
 * const { governance, isLoading, refetch } = usePricingGovernance();
 *
 * if (isLoading) return <Skeleton />;
 * return <PricingGovernancePanel />;
 * ```
 */
export function usePricingGovernance(
  options?: { readonly enabled?: boolean },
): UsePricingGovernanceReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;

  const { data: governance, isLoading, isRefetching, error, refetch } = useFetch(
    enabled ? () => stigmer.billing.getModelPricingGovernance() : null,
    [enabled, stigmer],
    null as ModelPricingGovernanceResponse | null,
  );

  return { governance, isLoading, isRefetching, error, refetch };
}
