"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { isNotFound } from "@stigmer/sdk";
import type { Subscription } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/api_pb";
import { GetSubscriptionForOrganizationInputSchema } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useSubscription}. */
export interface UseSubscriptionReturn {
  /**
   * The organization's subscription as stored; `null` when it never
   * subscribed (it is on Free) or before the first successful fetch.
   * A subscription that ended reads `canceled` with its period in the
   * past; {@link useEntitlements} says what the organization may do now.
   */
  readonly subscription: Subscription | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. Never NOT_FOUND. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that reads an organization's subscription.
 *
 * The server answers NOT_FOUND for an organization that never subscribed;
 * this hook reads that as `null`, because never subscribed is a state (the
 * Free plan), not a failure.
 *
 * Pass `null` as `orgId` to skip fetching. Refetches when the window
 * regains focus, so a plan changed in another window, or a card saved in
 * the system browser, shows on return.
 *
 * Cloud-only; the caller needs `can_view_billing` on the organization.
 *
 * @example
 * ```tsx
 * const { subscription } = useSubscription(orgId);
 * ```
 */
export function useSubscription(orgId: string | null): UseSubscriptionReturn {
  const stigmer = useStigmer();
  const { data: subscription, isLoading, isRefetching, error, refetch } = useFetch(
    orgId
      ? () =>
          stigmer.subscription
            .getForOrganization(create(GetSubscriptionForOrganizationInputSchema, { orgId }))
            .catch((err: unknown) => {
              if (isNotFound(err)) {
                return null;
              }
              throw err;
            })
      : null,
    [orgId, stigmer],
    null as Subscription | null,
    { refetchOnWindowFocus: true },
  );
  return useMemo(
    () => ({ subscription, isLoading, isRefetching, error, refetch }),
    [subscription, isLoading, isRefetching, error, refetch],
  );
}
