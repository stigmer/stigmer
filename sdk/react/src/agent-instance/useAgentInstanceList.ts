"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ListAgentInstancesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useAgentInstanceList}. */
export interface UseAgentInstanceListReturn {
  /** The fetched list of AgentInstance entries. Empty while loading or on error. */
  readonly agentInstances: readonly AgentInstance[];
  /** Total number of agent instances matching the query, including unpaged items. */
  readonly totalCount: number;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a paginated list of {@link AgentInstance} entries
 * for a given organization, with optional label filtering.
 *
 * Pass `null` as `org` to skip fetching (stable no-op). When the org
 * or labels change, the previous in-flight request is discarded and a
 * fresh fetch begins. Call `refetch()` to re-query after mutations.
 *
 * This is a Layer 1 building-block hook for the **Environment Flow**.
 * For the managed "personal agent instance" convenience, see
 * {@link usePersonalAgentInstance}.
 *
 * @example
 * ```tsx
 * const { agentInstances, isLoading } = useAgentInstanceList("acme", {
 *   "stigmer.ai/personal": "true",
 * });
 * ```
 */
export function useAgentInstanceList(
  org: string | null,
  labels?: Record<string, string>,
): UseAgentInstanceListReturn {
  const stigmer = useStigmer();
  const [agentInstances, setAgentInstances] = useState<AgentInstance[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

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
    if (!org) {
      setAgentInstances([]);
      setTotalCount(0);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.agentInstance
      .list(
        create(ListAgentInstancesRequestSchema, {
          org,
          labels: stableLabels ?? {},
        }),
      )
      .then(
        (result) => {
          if (cancelled.current) return;
          setAgentInstances(result.items);
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

  return { agentInstances, totalCount, isLoading, error, refetch };
}
