"use client";

import { useCallback, useEffect, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useAgent}. */
export interface UseAgentReturn {
  /** The resolved Agent, or `null` while loading, on error, or when not found. */
  readonly agent: Agent | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the agent from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single Agent blueprint by organization and slug.
 *
 * Wraps `stigmer.agent.getByReference()` with loading, error, and
 * not-found state management. When the `org` or `slug` parameters
 * change, the previous in-flight request is discarded and a fresh
 * fetch begins.
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable
 * no-op). This is useful when the slug is not yet available — for
 * example, while a parent component is still resolving route params.
 *
 * **Not-found handling:** If the API returns a 404 (NOT_FOUND), the
 * hook sets `agent` to `null` without raising an error. Consumers
 * distinguish "not found" from "loading" by checking all three fields:
 * `agent === null && !isLoading && !error` means the resource does
 * not exist.
 *
 * @example
 * ```tsx
 * function AgentDetail({ org, slug }: { org: string; slug: string }) {
 *   const { agent, isLoading, error } = useAgent(org, slug);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!agent) return <NotFound />;
 *
 *   return <h1>{agent.metadata?.name}</h1>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Skip fetching until slug is known
 * const { agent } = useAgent(org, slug ?? null);
 * ```
 */
export function useAgent(
  org: string | null,
  slug: string | null,
): UseAgentReturn {
  const stigmer = useStigmer();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org || !slug) {
      setAgent(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.agent.getByReference({ org, slug }).then(
      (result) => {
        if (cancelled.current) return;
        setAgent(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        if (isNotFound(err)) {
          setAgent(null);
          setIsLoading(false);
          return;
        }
        setError(toError(err));
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [org, slug, stigmer, fetchKey]);

  return { agent, isLoading, error, refetch };
}
