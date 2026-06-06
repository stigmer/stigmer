"use client";

import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import { GetAgentInstancesByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useAgentInstances}. */
export interface UseAgentInstancesReturn {
  /** Instances for the given agent, or empty array while loading. */
  readonly instances: readonly AgentInstance[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch instances from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all instances for a specific agent.
 *
 * Wraps `stigmer.agentInstance.getByAgent()` with loading and error
 * state management. Used on the Agent detail page "Instances" tab to
 * show environment-bound deployments of the agent blueprint.
 *
 * Pass `null` as `agentId` to skip fetching (stable no-op).
 *
 * Note: the `getByAgent` RPC returns an `AgentInstanceList` whose
 * entries live under `items` (unlike WorkflowInstance, which uses
 * `entries`).
 *
 * @example
 * ```tsx
 * const { instances, isLoading } = useAgentInstances(agent.metadata?.id);
 * ```
 */
export function useAgentInstances(
  agentId: string | null | undefined,
): UseAgentInstancesReturn {
  const stigmer = useStigmer();

  const fetchFn = agentId
    ? async () => {
        const resp = await stigmer.agentInstance.getByAgent(
          create(GetAgentInstancesByAgentRequestSchema, {
            agentId,
          }),
        );
        return resp.items ? [...resp.items] : [];
      }
    : null;

  const {
    data: instances,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useFetch<readonly AgentInstance[]>(fetchFn, [agentId, stigmer], []);

  return { instances, isLoading, isRefetching, error, refetch };
}
