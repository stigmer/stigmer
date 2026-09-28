"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import {
  GetEntitlementsInputSchema,
  type GetEntitlementsOutput,
} from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import type { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link useEntitlements}. */
export interface UseEntitlementsOptions {
  /** Skip fetching while `false` (stable no-op). Default `true`. */
  readonly enabled?: boolean;
}

/** Return value of {@link useEntitlements}. */
export interface UseEntitlementsReturn {
  /**
   * What the organization may do right now and the plan that permits it
   * (`planId` empty on Free), or `null` before the first successful fetch.
   */
  readonly entitlements: GetEntitlementsOutput | null;
  /**
   * Whether the organization's plan includes `feature` right now; `null`
   * until the entitlements have loaded, so a caller never refuses on a
   * guess.
   */
  readonly allows: (feature: Feature) => boolean | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that resolves what an organization's plan permits right now.
 *
 * The answer is derived by the server on every read: the live
 * subscription's plan, else Free's. A platform-managed organization
 * resolves through its integrator's plan. Every member may read it
 * (`can_view_billing` is granted to viewers).
 *
 * Cloud-only. Self-hosted editions answer from their license, not a plan,
 * so callers gate on the edition before reading (see `UpgradeNotice`).
 *
 * @example
 * ```tsx
 * const { allows } = useEntitlements(orgId);
 * if (allows(Feature.teams) === false) return <UpgradeNotice feature={Feature.teams} />;
 * ```
 */
export function useEntitlements(
  orgId: string | null,
  options?: UseEntitlementsOptions,
): UseEntitlementsReturn {
  const stigmer = useStigmer();
  const enabled = (options?.enabled ?? true) && orgId !== null && orgId !== "";
  const { data: entitlements, isLoading, error, refetch } = useFetch(
    enabled && orgId ? () => stigmer.subscription.getEntitlements(create(GetEntitlementsInputSchema, { orgId })) : null,
    [enabled, orgId, stigmer],
    null as GetEntitlementsOutput | null,
    { refetchOnWindowFocus: true },
  );
  const features = entitlements?.entitlements?.features;
  return useMemo(
    () => ({
      entitlements,
      allows: (feature: Feature) => (features === undefined ? null : features.includes(feature)),
      isLoading,
      error,
      refetch,
    }),
    [entitlements, features, isLoading, error, refetch],
  );
}
