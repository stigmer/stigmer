"use client";

import { isNotFound, isPermissionDenied } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useResolveAgentRunSession}. */
export interface UseResolveAgentRunSessionReturn {
  /**
   * The resolved session ID; `null` while loading, on error, and when no
   * session resolves (the run does not exist, the caller cannot see it, or
   * its target names no session).
   */
  readonly sessionId: string | null;
  /** `true` while the fetch is in flight. */
  readonly isLoading: boolean;
  /**
   * A failure to read the run, or `null`. A run that does not exist or that
   * the caller cannot see is not an error: it resolves to no session.
   */
  readonly error: Error | null;
  /** Reads the run again (after an error, for a retry). */
  readonly refetch: () => void;
}

/**
 * Resolves an AgentRun ID (`aex_*`) to its parent Session ID.
 *
 * This hook fetches the AgentRun resource and extracts
 * `spec.sessionId`. Use it when navigating from a context that
 * knows only the agent run ID (a schedule's run history, a run
 * link) to the session page (which requires the session ID).
 *
 * Pass `null` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * function DrillDown({ agentExecutionId }: { agentExecutionId: string }) {
 *   const { sessionId, isLoading } = useResolveAgentRunSession(agentExecutionId);
 *   useEffect(() => {
 *     if (sessionId) navigateToSession(sessionId);
 *   }, [sessionId]);
 *   if (isLoading) return <Spinner />;
 *   return null;
 * }
 * ```
 */
export function useResolveAgentRunSession(
  agentExecutionId: string | null,
): UseResolveAgentRunSessionReturn {
  const stigmer = useStigmer();

  const fetchFn = agentExecutionId
    ? async () => {
        try {
          const execution = await stigmer.agentRun.get(agentExecutionId);
          const target = execution.spec?.target;
          return target?.case === "sessionId" ? target.value : null;
        } catch (err) {
          if (isNotFound(err) || isPermissionDenied(err)) return null;
          throw err;
        }
      }
    : null;

  const { data: sessionId, isLoading, error, refetch } = useFetch(
    fetchFn,
    [agentExecutionId, stigmer],
    null,
  );

  return { sessionId, isLoading, error, refetch };
}
