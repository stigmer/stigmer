"use client";

import { useCallback, useEffect, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

export interface UseDefaultAgentReturn {
  /** The platform default agent, or null while loading / on error. */
  readonly agent: Agent | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the platform's default agent.
 *
 * The default agent is the one labeled `stigmer.ai/default-agent: "true"`
 * with `visibility_public`. It enables session-first UX where users
 * start a conversation without choosing an agent.
 *
 * Pass `null` for `org` to skip fetching (stable no-op). The hook
 * fetches once on mount and caches the result — the default agent
 * rarely changes within a session.
 *
 * @example
 * ```tsx
 * const { agent: defaultAgent, isLoading } = useDefaultAgent("acme");
 *
 * // Use defaultAgent.status.defaultInstanceId for session creation
 * // when the user hasn't explicitly selected an agent.
 * ```
 */
export function useDefaultAgent(org: string | null): UseDefaultAgentReturn {
  const stigmer = useStigmer();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) {
      setAgent(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.agent.getDefault({ org }).then(
      (result) => {
        if (cancelled.current) return;
        setAgent(result);
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
  }, [org, stigmer, fetchKey]);

  return { agent, isLoading, error, refetch };
}
