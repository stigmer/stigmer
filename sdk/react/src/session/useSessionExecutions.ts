"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ListAgentExecutionsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useSessionExecutions}. */
export interface UseSessionExecutionsReturn {
  /** All executions for the session, empty while loading or on error. */
  readonly executions: readonly AgentExecution[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the execution list from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches all {@link AgentExecution} entries for a session.
 *
 * Pass `null` to skip fetching (stable no-op). Call `refetch()` to
 * re-query after a new execution is created within the same session
 * (needed by the follow-up conversation loop in SP2).
 *
 * Returns up to 100 executions per call. Sessions rarely exceed a
 * handful of executions; full cursor-based pagination can be added
 * later without breaking the return type.
 */
export function useSessionExecutions(
  sessionId: string | null,
): UseSessionExecutionsReturn {
  const stigmer = useStigmer();
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!sessionId) {
      setExecutions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.agentExecution
      .listBySession(
        create(ListAgentExecutionsBySessionRequestSchema, {
          sessionId,
          pageSize: 100,
        }),
      )
      .then(
        (result) => {
          if (cancelled.current) return;
          setExecutions(result.entries);
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
  }, [sessionId, stigmer, fetchKey]);

  return { executions, isLoading, error, refetch };
}
