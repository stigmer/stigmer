"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { getAgentByReference } from "@/services/agent-service";
import { SYSTEM_AGENT_ORG } from "@/config/draft";

export interface UseDraftAgentReturn {
  agent: Agent | null;
  isResolving: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Resolves a system agent blueprint by slug from the "stigmer" organization.
 *
 * System agents (skill-creator, agent-creator, mcp-server-creator) are owned
 * by the platform org. This hook is independent of the user's active org —
 * it always resolves from {@link SYSTEM_AGENT_ORG}.
 */
export function useDraftAgent(slug: string): UseDraftAgentReturn {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const resolve = useCallback(async () => {
    if (!slug) return;

    const requestId = ++requestIdRef.current;
    setIsResolving(true);
    setError(null);

    try {
      const result = await getAgentByReference(SYSTEM_AGENT_ORG, slug);

      if (requestId !== requestIdRef.current) return;

      setAgent(result);
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;

      const message =
        err instanceof Error
          ? err.message
          : `Failed to resolve system agent "${slug}"`;
      setError(message);
      setAgent(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsResolving(false);
      }
    }
  }, [slug]);

  useEffect(() => {
    resolve();
  }, [resolve]);

  return { agent, isResolving, error, retry: resolve };
}
