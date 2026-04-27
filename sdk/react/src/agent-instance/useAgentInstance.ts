"use client";

import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useAgentInstance}. */
export interface UseAgentInstanceReturn {
  /** The fetched AgentInstance, or `null` while loading or on error. */
  readonly agentInstance: AgentInstance | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the agent instance from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single AgentInstance by resource reference.
 *
 * Pass `null` to skip fetching (stable no-op). When the reference
 * fields change, the previous in-flight request is discarded and a
 * fresh fetch begins. Call `refetch()` to re-query after mutating the
 * agent instance through a separate hook or API call.
 *
 * Returns the full proto {@link AgentInstance} resource so consumers
 * have access to metadata, spec (including `environment_refs` and
 * agent reference), and status without additional calls.
 *
 * This is a Layer 1 building-block hook for the **Environment Flow**
 * — agent instances bind Environment resources to Agent blueprints.
 * For the managed "personal agent instance" convenience, see
 * {@link usePersonalAgentInstance}.
 *
 * @example
 * ```tsx
 * const { agentInstance, isLoading, error } = useAgentInstance({
 *   org: "acme",
 *   slug: "my-agent-personal",
 * });
 * ```
 */
export function useAgentInstance(
  ref: ResourceRef | null,
): UseAgentInstanceReturn {
  const stigmer = useStigmer();

  const org = ref?.org;
  const slug = ref?.slug;
  const version = ref?.version;

  const fetchFn =
    org && slug
      ? () => stigmer.agentInstance.getByReference({ org, slug, version })
      : null;

  const { data: agentInstance, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, slug, version, stigmer],
    null,
  );

  return { agentInstance, isLoading, isRefetching, error, refetch };
}
