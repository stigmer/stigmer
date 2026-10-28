"use client";

// The kit's one read of which models can run for an organization. Every face
// that asks for one organization (the launcher, the model picker, Models &
// providers) shares one cached answer under one cache key, and a write that
// changes it (a key saved or removed) invalidates that key, so every face
// still mounted on it asks again. The wire's availability is mapped once,
// here, into the union the faces read; a value this build does not know
// reads as unknown, which never blocks a run.

import { useCallback, useEffect, useMemo } from "react";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  ProviderAvailability as WireAvailability,
  type GetModelReadinessOutput,
  type ModelReadiness as WireModelReadiness,
  type ProviderReadiness as WireProviderReadiness,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { useStigmer } from "../hooks.js";
import { useFetchCache } from "../internal/FetchCacheProvider.js";
import { useFetch } from "../internal/useFetch.js";
import type { HarnessOption } from "./harness.js";
import type { ModelReadiness, ModelReadinessLookup, ProviderAvailability, ProviderReadiness } from "./readiness.js";

/** Return value of {@link useModelReadiness}. */
export interface UseModelReadinessReturn {
  /** Each provider's report, in the server's order; `null` until the server answers. */
  readonly providers: readonly ProviderReadiness[] | null;
  /** Every catalog model on every engine this build knows, with whether it can run; `null` until the server answers. */
  readonly models: readonly ModelReadiness[] | null;
  /** `true` while the first answer is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed read, or `null`. A server too old to answer reads as an error, and nothing is marked. */
  readonly error: Error | null;
  /**
   * Asks the server again, after a key is saved or removed: every face
   * mounted on this organization's answer (under a `FetchCacheProvider`)
   * asks again with it.
   */
  readonly refetch: () => void;
  /** The readiness of one model on one engine; `undefined` while loading or for a model the server did not judge. */
  readonly readinessOf: ModelReadinessLookup;
}

/** The cache key the answer for `org` is held under, so every face of one organization shares one read. */
export function modelReadinessCacheKey(org: string): string {
  return `model-readiness:${org}`;
}

/**
 * Data hook: which models can run for `org`, as the server judges it
 * (`PlatformQueryController.getModelReadiness`). Each provider's standing,
 * and per model on each engine the provider it needs and that provider's.
 *
 * The answer is read from the same rule the server refuses a run by, so a
 * model reported missing is one whose run would be refused, and one
 * reported served or unknown is not refused for its provider. Every member
 * of the organization may ask. `org` null or empty skips the read (a guest,
 * who cannot ask, passes null).
 *
 * @example
 * ```tsx
 * const { readinessOf } = useModelReadiness(org);
 * const needsKey = readinessOf("stigmer", "claude-sonnet-4-6")?.availability.state === "missing";
 * ```
 */
export function useModelReadiness(org: string | null): UseModelReadinessReturn {
  const stigmer = useStigmer();
  const cache = useFetchCache();
  const enabled = org !== null && org !== "";
  const cacheKey = enabled ? modelReadinessCacheKey(org) : undefined;
  const {
    data,
    isLoading,
    error,
    refetch: fetchAgain,
  } = useFetch<GetModelReadinessOutput | null>(
    // Async, so a client that cannot ask (an older one) settles as an error.
    enabled ? async () => stigmer.platform.getModelReadiness(org) : null,
    [stigmer, org],
    null,
    { cacheKey },
  );

  // Another face's write invalidates the shared key; this one asks again.
  useEffect(() => {
    if (cache === null || cacheKey === undefined) return undefined;
    return cache.onInvalidate(cacheKey, fetchAgain);
  }, [cache, cacheKey, fetchAgain]);

  const refetch = useCallback(() => {
    if (cache !== null && cacheKey !== undefined) {
      // Reaches this hook too, through the listener above.
      cache.invalidate(cacheKey);
    } else {
      fetchAgain();
    }
  }, [cache, cacheKey, fetchAgain]);

  const providers = useMemo(() => (data === null ? null : data.providers.map(providerOf)), [data]);
  const models = useMemo(
    () => (data === null ? null : data.models.flatMap((model) => modelOf(model) ?? [])),
    [data],
  );

  const readinessOf = useCallback<ModelReadinessLookup>(
    (harness, modelId) => models?.find((model) => model.harness === harness && model.modelId === modelId),
    [models],
  );

  return useMemo(
    () => ({ providers, models, isLoading, error, refetch, readinessOf }),
    [providers, models, isLoading, error, refetch, readinessOf],
  );
}

/** The engines this build names, by their wire value. */
const HARNESS_OF_WIRE: Partial<Record<Harness, HarnessOption>> = {
  [Harness.STIGMER]: "stigmer",
  [Harness.CLAUDE]: "claude",
};

function providerOf(wire: WireProviderReadiness): ProviderReadiness {
  return { provider: wire.provider, availability: availabilityOf(wire.availability, wire.parentOrg) };
}

/** A wire model on an engine this build names; one on an engine it does not name is left out. */
function modelOf(wire: WireModelReadiness): ModelReadiness | undefined {
  const harness = HARNESS_OF_WIRE[wire.harness];
  if (harness === undefined) {
    return undefined;
  }
  return {
    harness,
    modelId: wire.model,
    provider: wire.provider,
    availability: availabilityOf(wire.availability, ""),
  };
}

/**
 * Each wire availability as the kit's union, keyed by every value the
 * contract names, so a value added to it is a compile error here until it
 * is mapped.
 */
const AVAILABILITY: Readonly<Record<WireAvailability, (parentOrg: string) => ProviderAvailability>> = {
  [WireAvailability.served_by_organization]: () => ({ state: "served", source: "organization", parentOrg: "" }),
  [WireAvailability.served_by_parent_organization]: (parentOrg) => ({ state: "served", source: "parent", parentOrg }),
  [WireAvailability.served_by_runners]: () => ({ state: "served", source: "runners", parentOrg: "" }),
  [WireAvailability.missing_from_organization]: () => ({ state: "missing", scope: "organization" }),
  [WireAvailability.missing_from_runners]: () => ({ state: "missing", scope: "runners" }),
  [WireAvailability.availability_unknown]: () => ({ state: "unknown" }),
  [WireAvailability.provider_availability_unspecified]: () => ({ state: "unknown" }),
};

/** The wire's availability as the kit's union; a value newer than this build reads as unknown. */
function availabilityOf(wire: WireAvailability, parentOrg: string): ProviderAvailability {
  const known: Partial<Record<number, (parentOrg: string) => ProviderAvailability>> = AVAILABILITY;
  return known[wire]?.(parentOrg) ?? { state: "unknown" };
}
