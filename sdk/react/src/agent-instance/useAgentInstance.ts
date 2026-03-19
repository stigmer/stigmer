"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { useStigmer } from "../hooks";

export interface UseAgentInstanceReturn {
  readonly agentInstance: AgentInstance | null;
  readonly isLoading: boolean;
  readonly error: string | null;
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
 * This is a Layer 1 building-block hook for platform builders who
 * manage agent instances programmatically. For the "personal agent
 * instance" flow used by the Stigmer Console, see
 * `usePersonalAgentInstance`.
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
  const [agentInstance, setAgentInstance] = useState<AgentInstance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  const org = ref?.org;
  const slug = ref?.slug;
  const version = ref?.version;

  useEffect(() => {
    if (!org || !slug) {
      setAgentInstance(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.agentInstance.getByReference({ org, slug, version }).then(
      (result) => {
        if (cancelled.current) return;
        setAgentInstance(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load agent instance",
        );
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [org, slug, version, stigmer, fetchKey]);

  return { agentInstance, isLoading, error, refetch };
}
