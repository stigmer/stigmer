"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ListEnvironmentsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useEnvironmentList}. */
export interface UseEnvironmentListReturn {
  /** The fetched list of Environment entries. Empty while loading or on error. */
  readonly environments: readonly Environment[];
  /** Total number of environments matching the query, including unpaged items. */
  readonly totalCount: number;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
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
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(!!org);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  // Synchronously reset loading state when org changes so that
  // downstream hooks see isLoading=true in the SAME render —
  // not deferred to the next render via an effect.
  const [prevOrg, setPrevOrg] = useState(org);
  if (org !== prevOrg) {
    setPrevOrg(org);
    if (org) {
      setIsLoading(true);
      setEnvironments([]);
      setTotalCount(0);
      setError(null);
    } else {
      setIsLoading(false);
      setEnvironments([]);
      setTotalCount(0);
      setError(null);
    }
  }

  const labelsRef = useRef(labels);
  if (
    labels !== labelsRef.current &&
    JSON.stringify(labels) !== JSON.stringify(labelsRef.current)
  ) {
    labelsRef.current = labels;
  }
  const stableLabels = labelsRef.current;

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) return;

    const cancelled = { current: false };

    stigmer.environment
      .list(
        create(ListEnvironmentsRequestSchema, {
          org,
          labels: stableLabels ?? {},
        }),
      )
      .then(
        (result) => {
          if (cancelled.current) return;
          setEnvironments(result.items);
          setTotalCount(result.totalCount);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [org, stableLabels, stigmer, fetchKey]);

  return { environments, totalCount, isLoading, error, refetch };
}
