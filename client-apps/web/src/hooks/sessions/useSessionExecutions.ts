"use client";

import { useQuery } from "@tanstack/react-query";
import { useExecutionService } from "@stigmer/agent-execution";
import { sessionKeys } from "./keys";

/**
 * Fetches all executions for a session.
 *
 * Composes the existing {@link ExecutionService.listExecutionsBySession}
 * (Layer 2 from `@stigmer/agent-execution`) with a TanStack Query
 * wrapper (Layer 3). No new service factory is needed for executions.
 */
export function useSessionExecutions(sessionId: string) {
  const executionService = useExecutionService();

  return useQuery({
    queryKey: sessionKeys.executions(sessionId),
    queryFn: () =>
      executionService.listExecutionsBySession(sessionId, { pageSize: 100 }),
    enabled: !!sessionId,
  });
}
