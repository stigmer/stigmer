"use client";

import { useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ListEnvironmentsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useEnvironmentList}. */
export interface UseEnvironmentListReturn {
  /** The fetched list of Environment entries. Empty while loading or on error. */
  readonly environments: readonly Environment[];
  /** Total number of environments matching the query, including unpaged items. */
  readonly totalCount: number;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a paginated list of {@link Environment} entries
 * for a given organization, with optional label filtering.
 *
 * Pass `null` as `org` to skip fetching (stable no-op). When the org
 * or labels change, the previous in-flight request is discarded and a
 * fresh fetch begins. Call `refetch()` to re-query after mutations.
 *
 * Secret values in returned environments are redacted server-side.
 *
 * This is a Layer 1 building-block hook for the **Environment Flow**.
 * For the managed "personal environment" convenience, see
 * {@link usePersonalEnvironment}.
 *
 * @example
 * ```tsx
 * const { environments, isLoading } = useEnvironmentList("acme", {
 *   "stigmer.ai/personal": "true",
 * });
 * ```
 */
export function useEnvironmentList(
  org: string | null,
  labels?: Record<string, string>,
): UseEnvironmentListReturn {
  const stigmer = useStigmer();

  const labelsRef = useRef(labels);
  if (
    labels !== labelsRef.current &&
    JSON.stringify(labels) !== JSON.stringify(labelsRef.current)
  ) {
    labelsRef.current = labels;
  }
  const stableLabels = labelsRef.current;

  const fetchFn = org
    ? async () => {
        const result = await stigmer.environment.list(
          create(ListEnvironmentsRequestSchema, {
            org,
            labels: stableLabels ?? {},
          }),
        );
        return {
          environments: result.items as Environment[],
          totalCount: result.totalCount,
        };
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, stableLabels, stigmer],
    { environments: [] as Environment[], totalCount: 0 },
  );

  return {
    environments: data.environments,
    totalCount: data.totalCount,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
