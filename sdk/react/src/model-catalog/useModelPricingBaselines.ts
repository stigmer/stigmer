"use client";

import type {
  ModelPricingBaseline,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { everyEntry } from "@stigmer/client";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link useModelPricingBaselines}. */
export interface UseModelPricingBaselinesOptions {
  /**
   * When `true`, includes SUPERSEDED and RETIRED revisions (the full
   * append-only audit history). Default: ACTIVE entries only.
   */
  readonly includeHistory?: boolean;
  /** Pass `false` to skip fetching (stable no-op). */
  readonly enabled?: boolean;
}

/** Return value of {@link useModelPricingBaselines}. */
export interface UseModelPricingBaselinesReturn {
  /** The catalog entries, or `null` before the first successful fetch. */
  readonly baselines: readonly ModelPricingBaseline[] | null;
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
 * Data hook that fetches the model registry baseline catalog: the
 * operator-authored catalog entries and list prices the served model
 * registry is built from.
 *
 * Platform-operator surface: the caller needs `can_manage_model_pricing`
 * on `platform:stigmer`, and the rates are raw provider prices
 * (pre-markup) — never render them as customer prices.
 *
 * @example
 * ```tsx
 * const { baselines, isLoading, refetch } = useModelPricingBaselines();
 * ```
 */
export function useModelPricingBaselines(
  options?: UseModelPricingBaselinesOptions,
): UseModelPricingBaselinesReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;
  const includeHistory = options?.includeHistory ?? false;

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    enabled
      ? async () => {
          // The catalog view prices every model, so it reads every page.
          // The catalog is the platform's own, not a person's rows, and
          // its history grows with each price change, so the walk has no
          // cap of its own.
          const baselines: ModelPricingBaseline[] = [];
          for await (const baseline of everyEntry((pageToken) =>
            stigmer.billing.listModelPricingBaselines({
              includeHistory,
              pageSize: LIST_PAGE_MAX,
              pageToken,
            }),
          )) {
            baselines.push(baseline);
          }
          return baselines;
        }
      : null,
    [enabled, includeHistory, stigmer],
    null as readonly ModelPricingBaseline[] | null,
  );

  return { baselines: data, isLoading, isRefetching, error, refetch };
}
