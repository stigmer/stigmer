"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import {
  GetAgentHoursInputSchema,
  type AgentHours,
} from "@stigmer/apis/ai/stigmer/billing/subscription/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";

/** Options for {@link useAgentHours}. */
export interface UseAgentHoursOptions {
  /** Skip fetching while `false`: read only where subscriptions are served and the organization is not a child. Default `true`. */
  readonly enabled?: boolean;
}

/** Return value of {@link useAgentHours}. */
export interface UseAgentHoursReturn {
  /** Where the organization stands against its plan's agent hours, or `null` before the first successful fetch. */
  readonly hours: AgentHours | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that reads where an organization stands against its plan's
 * agent hours: the working seconds used in the current window (Free's
 * calendar month, or the subscription's billing period), the hours the
 * plan includes and its price for each hour past them.
 *
 * It answers for every plan, Free included, and counts the organization's
 * and its child organizations' work in Stigmer's sandboxes, never an
 * automatic grade's. The server answers NOT_FOUND for a child
 * organization, which is on its parent's plan, so disable it there.
 *
 * Cloud-only; the caller needs `can_view_billing` on the organization.
 */
export function useAgentHours(org: string | null, options?: UseAgentHoursOptions): UseAgentHoursReturn {
  const stigmer = useStigmer();
  const enabled = (options?.enabled ?? true) && org !== null && org !== "";
  const { data: hours, isLoading, error, refetch } = useFetch(
    enabled && org ? () => stigmer.subscription.getAgentHours(create(GetAgentHoursInputSchema, { org })) : null,
    [enabled, org, stigmer],
    null as AgentHours | null,
    { refetchOnWindowFocus: true },
  );
  return useMemo(() => ({ hours, isLoading, error, refetch }), [hours, isLoading, error, refetch]);
}
