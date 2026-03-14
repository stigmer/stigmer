"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { getAgent } from "@/services/agent-service";

export interface UseAgentDetailReturn {
  agent: Agent | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches a full Agent resource by ID.
 *
 * Returns the complete agent including metadata, spec (instructions,
 * MCP server usages, skill refs, sub-agents), and status.
 */
export function useAgentDetail(agentId: string): UseAgentDetailReturn {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const fetchAgent = useCallback(async () => {
    if (!agentId) return;

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await getAgent(agentId);

      if (requestId !== requestIdRef.current) return;

      setAgent(result);
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;

      const message =
        err instanceof Error ? err.message : "Failed to load agent";
      setError(message);
      setAgent(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [agentId]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  return { agent, isLoading, error, refresh: fetchAgent };
}
