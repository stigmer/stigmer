"use client";

import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import { GetAgentInstancesByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

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
 * Data hook that fetches instances for a specific agent.
 *
 * Wraps `stigmer.agentInstance.getByAgent()` with loading and error
 * state management. Used on the Agent detail page "Instances" tab to
 * show environment-bound deployments of the agent blueprint.
 *
 * Pass `org` to scope the list to one organization's instances — the
 * org-context view a console tab needs. Permissions alone cannot provide
 * this scope: a member of several orgs can view all of their orgs'
 * instances of the agent, so the unscoped list merges them. The server
 * applies the scope (it only ever narrows the permission-bounded view);
 * omit `org` for the full permission-bounded list.
 *
 * Pass `null` as `agentId` to skip fetching (stable no-op).
 *
 * Note: the `getByAgent` RPC returns an `AgentInstanceList` whose
 * entries live under `items` (unlike WorkflowInstance, which uses
 * `entries`).
 *
 * @example
 * ```tsx
 * const { instances, isLoading } = useAgentInstances(agent.metadata?.id, viewerOrg);
 * ```
 */
export function useAgentInstances(
  agentId: string | null | undefined,
  org?: string,
): UseAgentInstancesReturn {
  const stigmer = useStigmer();

  const fetchFn = agentId
    ? async () => {
        const resp = await stigmer.agentInstance.getByAgent(
          create(GetAgentInstancesByAgentRequestSchema, {
            agentId,
            org: org ?? "",
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
  } = useFetch<readonly AgentInstance[]>(fetchFn, [agentId, org, stigmer], []);

  return { instances, isLoading, isRefetching, error, refetch };
}
