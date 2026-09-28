"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { Plan } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { ListPlansInputSchema } from "@stigmer/protos/ai/stigmer/billing/plan/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link usePlans}. */
export interface UsePlansOptions {
  /** Include retired plans beside the ones that can still be bought. Default `false`. */
  readonly includeRetired?: boolean;
  /** Skip fetching while `false` (stable no-op). Default `true`. */
  readonly enabled?: boolean;
}

/** Return value of {@link usePlans}. */
export interface UsePlansReturn {
  /** The catalog's plans, or `null` before the first successful fetch. */
  readonly plans: readonly Plan[] | null;
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
 * Data hook that lists the Stigmer Cloud plan catalog.
 *
 * Every signed-in caller may read it. By default it lists only the plans
 * that can still be bought; `includeRetired` adds the retired rows an
 * operator audits. Free is not a row: an organization with no live
 * subscription is on Free.
 *
 * Cloud-only: other editions serve no plans.
 *
 * @example
 * ```tsx
 * const { plans } = usePlans();
 * ```
 */
export function usePlans(options?: UsePlansOptions): UsePlansReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;
  const includeRetired = options?.includeRetired ?? false;
  const { data: plans, isLoading, isRefetching, error, refetch } = useFetch(
    enabled
      ? () =>
          stigmer.plan
            .list(create(ListPlansInputSchema, { includeRetired }))
            .then((result): readonly Plan[] => result.entries)
      : null,
    [enabled, includeRetired, stigmer],
    null as readonly Plan[] | null,
  );
  return useMemo(
    () => ({ plans, isLoading, isRefetching, error, refetch }),
    [plans, isLoading, isRefetching, error, refetch],
  );
}
