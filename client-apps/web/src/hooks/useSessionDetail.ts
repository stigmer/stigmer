"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useExecutionService, isTerminalPhase } from "@stigmer/react-ui/execution";
import { getSession } from "@/services/session-service";

export interface UseSessionDetailReturn {
  /** The session resource. Null until loaded. */
  session: Session | null;
  /** All executions in this session, ordered by creation time (oldest first). */
  executions: AgentExecution[];
  /** Executions that have reached a terminal phase. */
  pastExecutions: AgentExecution[];
  /**
   * The most recent execution if it is still active (non-terminal phase).
   * Null when all executions are complete or the session has no executions.
   */
  activeExecution: AgentExecution | null;
  /** True while initial data is being fetched. */
  isLoading: boolean;
  /** Error message from session or execution fetch. Null when healthy. */
  error: string | null;
  /** Re-fetch both the session and its executions. */
  refresh: () => void;
}

/**
 * Loads a session and all of its executions.
 *
 * Separates executions into "past" (terminal) and "active" (latest non-terminal).
 * The session detail page uses pastExecutions for the read-only conversation
 * history and activeExecution for the live streaming view.
 */
export function useSessionDetail(sessionId: string): UseSessionDetailReturn {
  const executionService = useExecutionService();
  const [session, setSession] = useState<Session | null>(null);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!sessionId) return;

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const [sessionResult, executionsResult] = await Promise.all([
        getSession(sessionId),
        executionService.listExecutionsBySession(sessionId, { pageSize: 100 }),
      ]);

      if (requestId !== requestIdRef.current) return;

      setSession(sessionResult);
      setExecutions(executionsResult.entries);
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;

      const message =
        err instanceof Error ? err.message : "Failed to load session";
      setError(message);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [sessionId, executionService]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const lastExecution = executions.length > 0
    ? executions[executions.length - 1]
    : null;

  const lastPhase = lastExecution?.status?.phase
    ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  const activeExecution =
    lastExecution && !isTerminalPhase(lastPhase) ? lastExecution : null;

  const pastExecutions = activeExecution
    ? executions.slice(0, -1)
    : executions;

  return {
    session,
    executions,
    pastExecutions,
    activeExecution,
    isLoading,
    error,
    refresh: fetchData,
  };
}
