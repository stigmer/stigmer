"use client";

import { useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ListAgentInstancesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useAgentInstanceList}. */
export interface UseAgentInstanceListReturn {
  /** The fetched list of AgentInstance entries. Empty while loading or on error. */
  readonly agentInstances: readonly AgentInstance[];
  /** Total number of agent instances matching the query, including unpaged items. */
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
        const result = await stigmer.agentInstance.list(
          create(ListAgentInstancesRequestSchema, {
            org,
            labels: stableLabels ?? {},
          }),
        );
        return {
          agentInstances: result.items as AgentInstance[],
          totalCount: result.totalCount,
        };
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, stableLabels, stigmer],
    { agentInstances: [] as AgentInstance[], totalCount: 0 },
  );

  return {
    agentInstances: data.agentInstances,
    totalCount: data.totalCount,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
