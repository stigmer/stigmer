"use client";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useAgent}. */
export interface UseAgentReturn {
  /** The resolved Agent, or `null` while loading, on error, or when not found. */
  readonly agent: Agent | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
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

  const fetchFn =
    org && slug
      ? async () => {
          try {
            return await stigmer.agent.getByReference({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null;

  const { data: agent, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, slug, stigmer],
    null,
  );

  return { agent, isLoading, isRefetching, error, refetch };
}
