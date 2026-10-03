"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import {
  GetPeriodEstimateInputSchema,
  type PeriodEstimate,
} from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link usePeriodEstimate}. */
export interface UsePeriodEstimateOptions {
  /** Skip fetching while `false`: read only while a subscription is live. Default `true`. */
  readonly enabled?: boolean;
}

/** Return value of {@link usePeriodEstimate}. */
export interface UsePeriodEstimateReturn {
  /** The current period's estimated invoice, or `null` before the first successful fetch. */
  readonly estimate: PeriodEstimate | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that estimates what an organization's current subscription
 * period will be invoiced.
 *
 * The estimate is the invoice the period would close with if no further
 * usage occurred: the plan's minimum for the whole period (or its share of
 * the period's provider cost, whichever is greater), less the commission
 * already collected on tokens, plus managed organizations beyond those
 * included. The server rates it by the same rule the monthly close
 * invoices by, so it agrees with the invoice to the cent.
 *
 * The server answers NOT_FOUND when nothing is live to invoice (Free, or a
 * managed organization), so enable it only while a subscription is live.
 *
 * Cloud-only; the caller needs `can_view_billing` on the organization.
 */
export function usePeriodEstimate(
  org: string | null,
  options?: UsePeriodEstimateOptions,
): UsePeriodEstimateReturn {
  const stigmer = useStigmer();
  const enabled = (options?.enabled ?? true) && org !== null && org !== "";
  const { data: estimate, isLoading, error, refetch } = useFetch(
    enabled && org ? () => stigmer.subscription.getPeriodEstimate(create(GetPeriodEstimateInputSchema, { org })) : null,
    [enabled, org, stigmer],
    null as PeriodEstimate | null,
    { refetchOnWindowFocus: true },
  );
  return useMemo(() => ({ estimate, isLoading, error, refetch }), [estimate, isLoading, error, refetch]);
}
