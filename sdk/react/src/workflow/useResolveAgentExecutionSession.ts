"use client";

import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useResolveAgentExecutionSession}. */
export interface UseResolveAgentExecutionSessionReturn {
  /** The resolved session ID, or `null` while loading or on error. */
  readonly sessionId: string | null;
  /** `true` while the fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Resolves an AgentExecution ID (`aex_*`) to its parent Session ID.
 *
 * This hook fetches the AgentExecution resource and extracts
 * `spec.sessionId`. Use it when navigating from a workflow execution
 * context (which knows the child agent execution ID) to the session
 * page (which requires the session ID).
 *
 * Pass `null` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * function DrillDown({ agentExecutionId }: { agentExecutionId: string }) {
 *   const { sessionId, isLoading } = useResolveAgentExecutionSession(agentExecutionId);
 *   useEffect(() => {
 *     if (sessionId) navigateToSession(sessionId);
 *   }, [sessionId]);
 *   if (isLoading) return <Spinner />;
 *   return null;
 * }
 * ```
 */
export function useResolveAgentExecutionSession(
  agentExecutionId: string | null,
): UseResolveAgentExecutionSessionReturn {
  const stigmer = useStigmer();

  const fetchFn = agentExecutionId
    ? async () => {
        const execution = await stigmer.agentExecution.get(agentExecutionId);
        return execution.spec?.sessionId ?? null;
      }
    : null;

  const { data: sessionId, isLoading, error } = useFetch(
    fetchFn,
    [agentExecutionId, stigmer],
    null,
  );

  return { sessionId, isLoading, error };
}
