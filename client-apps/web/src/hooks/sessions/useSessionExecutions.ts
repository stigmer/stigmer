"use client";

import { useQuery } from "@tanstack/react-query";
import { useStigmer } from "@stigmer/react";
import { create } from "@bufbuild/protobuf";
import { ListAgentExecutionsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { sessionKeys } from "./keys";

/**
 * Fetches all executions for a session.
 */
export function useSessionExecutions(sessionId: string) {
  const stigmer = useStigmer();

  return useQuery({
    queryKey: sessionKeys.executions(sessionId),
    queryFn: () =>
      stigmer.agentExecution.listBySession(
        create(ListAgentExecutionsBySessionRequestSchema, {
          sessionId,
          pageSize: 100,
        }),
      ),
    enabled: !!sessionId,
  });
}
