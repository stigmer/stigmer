"use client";

import { useMemo } from "react";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { useAgentInstanceList } from "./useAgentInstanceList";

const PERSONAL_LABELS: Record<string, string> = {
  "stigmer.ai/personal": "true",
};

export interface UsePersonalAgentInstanceReturn {
  readonly agentInstance: AgentInstance | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/**
 * Convenience hook that fetches the caller's personal {@link AgentInstance}
 * for a given organization, optionally scoped to a specific agent.
 *
 * Wraps {@link useAgentInstanceList} with the `stigmer.ai/personal: "true"`
 * label filter. When `agentId` is provided, the result is further
 * filtered client-side to match `spec.agentId`. The invariant (at most
 * one personal agent instance per agent per org per user) is enforced at
 * creation time — this hook simply queries what exists.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * // All personal instances in org
 * const { agentInstance } = usePersonalAgentInstance("acme");
 *
 * // Personal instance for a specific agent
 * const { agentInstance } = usePersonalAgentInstance("acme", "agent-abc123");
 * ```
 */
export function usePersonalAgentInstance(
  org: string | null,
  agentId?: string,
): UsePersonalAgentInstanceReturn {
  const { agentInstances, isLoading, error, refetch } = useAgentInstanceList(
    org,
    PERSONAL_LABELS,
  );

  const agentInstance = useMemo(() => {
    if (agentInstances.length === 0) return null;
    if (!agentId) return agentInstances[0] ?? null;
    return (
      agentInstances.find((ai) => ai.spec?.agentId === agentId) ?? null
    );
  }, [agentInstances, agentId]);

  return { agentInstance, isLoading, error, refetch };
}
