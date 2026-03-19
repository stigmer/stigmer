"use client";

import { useCallback, useEffect, useState } from "react";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { useStigmer } from "../hooks";

export interface UseEnvironmentReturn {
  readonly environment: Environment | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single Environment by resource reference.
 *
 * Pass `null` to skip fetching (stable no-op). When the reference
 * fields change, the previous in-flight request is discarded and a
 * fresh fetch begins. Call `refetch()` to re-query after mutating the
 * environment through a separate hook or API call.
 *
 * Returns the full proto {@link Environment} resource so consumers
 * have access to metadata, spec (including `data` key-value pairs),
 * and status without additional calls.
 *
 * This is a Layer 1 building-block hook for platform builders who
 * manage environments programmatically. For the "personal environment"
 * flow used by the Stigmer Console, see `usePersonalEnvironment`.
 *
 * @example
 * ```tsx
 * const { environment, isLoading, error } = useEnvironment({
 *   org: "acme",
 *   slug: "prod-env",
 * });
 * ```
 */
export function useEnvironment(
  ref: ResourceRef | null,
): UseEnvironmentReturn {
  const stigmer = useStigmer();
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  const org = ref?.org;
  const slug = ref?.slug;
  const version = ref?.version;

  useEffect(() => {
    if (!org || !slug) {
      setEnvironment(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.environment.getByReference({ org, slug, version }).then(
      (result) => {
        if (cancelled.current) return;
        setEnvironment(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load environment",
        );
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [org, slug, version, stigmer, fetchKey]);

  return { environment, isLoading, error, refetch };
}
