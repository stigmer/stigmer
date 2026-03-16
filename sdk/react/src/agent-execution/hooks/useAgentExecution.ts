"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import { CancelAgentExecutionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../../hooks.js";
import { isTerminalPhase } from "../helpers.js";

export interface CreateExecutionInput {
  agentId?: string;
  sessionId?: string;
  message: string;
  org: string;
}

export interface UseAgentExecutionOptions {
  executionId?: string;
}

export interface UseAgentExecutionReturn {
  execution: AgentExecution | null;
  phase: ExecutionPhase;
  isConnected: boolean;
  error: string | null;
  start: (input: CreateExecutionInput) => Promise<void>;
  cancel: (reason?: string) => Promise<void>;
}

export function useAgentExecution(
  options?: UseAgentExecutionOptions,
): UseAgentExecutionReturn {
  const stigmer = useStigmer();
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
          const stream = stigmer.agentExecution.subscribe(
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
    [stigmer],
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
        const created = await stigmer.agentExecution.create({
          name: "",
          org: input.org,
          agentId: input.agentId,
          sessionId: input.sessionId,
          message: input.message,
        });
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
    [stigmer, subscribe],
  );

  const cancel = useCallback(
    async (reason?: string) => {
      const id = activeExecutionIdRef.current;
      if (!id) return;
      try {
        await stigmer.agentExecution.cancel(
          create(CancelAgentExecutionInputSchema, {
            id,
            reason: reason ?? "",
          }),
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to cancel execution";
        setError(message);
      }
    },
    [stigmer],
  );

  const phase =
    execution?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  return { execution, phase, isConnected, error, start, cancel };
}
