"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useExecutionService } from "./useExecutionService";
import { isTerminalPhase } from "../helpers";
import type { CreateExecutionInput } from "../services/execution-service";

export type { CreateExecutionInput };

export interface UseAgentExecutionOptions {
  /** Subscribe to an existing execution on mount. */
  executionId?: string;
}

export interface UseAgentExecutionReturn {
  /** The latest execution state from the stream. Null before subscription starts. */
  execution: AgentExecution | null;
  /** Convenience accessor — the current phase (defaults to UNSPECIFIED when no execution). */
  phase: ExecutionPhase;
  /** True while the subscription stream is open and receiving updates. */
  isConnected: boolean;
  /** Error message from creation, subscription, or cancellation. Null when healthy. */
  error: string | null;
  /** Create a new execution and auto-subscribe to its stream. */
  start: (input: CreateExecutionInput) => Promise<void>;
  /** Gracefully cancel the current execution. */
  cancel: (reason?: string) => Promise<void>;
}

export function useAgentExecution(
  options?: UseAgentExecutionOptions,
): UseAgentExecutionReturn {
  const service = useExecutionService();
  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeExecutionIdRef = useRef<string | null>(
    options?.executionId ?? null,
  );
  const abortRef = useRef<AbortController | null>(null);

  const subscribe = useCallback(
    (executionId: string) => {
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;
      activeExecutionIdRef.current = executionId;
      setIsConnected(true);
      setError(null);

      (async () => {
        try {
          const stream = service.subscribeToExecution(
            executionId,
            controller.signal,
          );
          for await (const update of stream) {
            if (controller.signal.aborted) break;
            setExecution(update);

            const phase =
              update.status?.phase ??
              ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
            if (isTerminalPhase(phase)) {
              setIsConnected(false);
              break;
            }
          }
        } catch (err: unknown) {
          if (controller.signal.aborted) return;
          const message =
            err instanceof Error ? err.message : "Stream disconnected";
          setError(message);
        } finally {
          if (!controller.signal.aborted) {
            setIsConnected(false);
          }
        }
      })();
    },
    [service],
  );

  useEffect(() => {
    if (options?.executionId) {
      subscribe(options.executionId);
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [options?.executionId, subscribe]);

  const start = useCallback(
    async (input: CreateExecutionInput) => {
      setError(null);
      setExecution(null);
      try {
        const created = await service.createExecution(input);
        const executionId = created.metadata?.id;
        if (!executionId) {
          throw new Error("Created execution missing metadata.id");
        }
        setExecution(created);
        subscribe(executionId);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to create execution";
        setError(message);
      }
    },
    [service, subscribe],
  );

  const cancel = useCallback(
    async (reason?: string) => {
      const id = activeExecutionIdRef.current;
      if (!id) return;
      try {
        await service.cancelExecution(id, reason);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to cancel execution";
        setError(message);
      }
    },
    [service],
  );

  const phase =
    execution?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  return { execution, phase, isConnected, error, start, cancel };
}
