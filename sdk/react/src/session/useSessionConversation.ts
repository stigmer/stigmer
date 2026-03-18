"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { isTerminalPhase } from "../execution/execution-phases";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution";
import { useExecutionStream } from "../execution/useExecutionStream";
import { useSession } from "./useSession";
import { useSessionExecutions } from "./useSessionExecutions";

export interface UseSessionConversationReturn {
  /** The session object, or null while loading. */
  readonly session: Session | null;
  /** Executions in terminal phases, in chronological order. */
  readonly completedExecutions: readonly AgentExecution[];
  /** Currently streaming execution (stream or fetch fallback), or null. */
  readonly activeStreamExecution: AgentExecution | null;
  /** Phase of the active execution, or null if none active. */
  readonly activePhase: ExecutionPhase | null;
  /** True while the active execution's stream is delivering updates. */
  readonly isStreaming: boolean;

  /** Submit a follow-up message. Internally creates an execution and starts streaming it. */
  readonly sendFollowUp: (message: string, modelName?: string) => Promise<void>;
  /** True when the input should be enabled (no active execution, not creating). */
  readonly canSendFollowUp: boolean;
  /** True during the create RPC call (between submit and execution ID). */
  readonly isSending: boolean;
  /** Error from the last sendFollowUp attempt, or null. */
  readonly sendError: string | null;
  readonly clearSendError: () => void;

  /** The user's message text, shown in the thread before the stream delivers it. */
  readonly pendingUserMessage: string | null;

  readonly isLoading: boolean;
  readonly loadError: string | null;

  readonly streamError: string | null;
  readonly reconnectStream: () => void;
}

/**
 * Behavior hook that encapsulates the full conversation lifecycle for
 * a session: loading data, streaming the active execution, and
 * submitting follow-up messages.
 *
 * Composes {@link useSession}, {@link useSessionExecutions},
 * {@link useCreateAgentExecution}, and {@link useExecutionStream} into
 * a single return value that drives both {@link MessageThread} and
 * {@link FollowUpInput}.
 *
 * Platform builders get the complete conversation loop without
 * reimplementing orchestration logic.
 *
 * @param sessionId - Session to display and converse in. Pass `null` to skip.
 * @param org - Organization slug for creating follow-up executions.
 *
 * @example
 * ```tsx
 * function Chat({ sessionId, org }: { sessionId: string; org: string }) {
 *   const conv = useSessionConversation(sessionId, org);
 *
 *   if (conv.isLoading) return <Spinner />;
 *
 *   return (
 *     <>
 *       <MessageThread
 *         executions={conv.completedExecutions}
 *         activeStreamExecution={conv.activeStreamExecution}
 *         pendingUserMessage={conv.pendingUserMessage}
 *       />
 *       <FollowUpInput
 *         onSubmit={conv.sendFollowUp}
 *         disabled={!conv.canSendFollowUp}
 *         isSubmitting={conv.isSending}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function useSessionConversation(
  sessionId: string | null,
  org: string,
): UseSessionConversationReturn {
  const { session, isLoading: sessionLoading, error: sessionError } =
    useSession(sessionId);
  const {
    executions,
    isLoading: executionsLoading,
    error: executionsError,
    refetch,
  } = useSessionExecutions(sessionId);
  const {
    create,
    isCreating,
    error: createError,
    clearError: clearCreateError,
  } = useCreateAgentExecution();

  const [pendingExecutionId, setPendingExecutionId] = useState<string | null>(
    null,
  );
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );

  const listActiveId = useMemo(() => {
    for (let i = executions.length - 1; i >= 0; i--) {
      const phase = executions[i].status?.phase;
      if (phase === undefined || !isTerminalPhase(phase)) {
        return executions[i].metadata?.id ?? null;
      }
    }
    return null;
  }, [executions]);

  const activeExecutionId = pendingExecutionId ?? listActiveId;

  const stream = useExecutionStream(activeExecutionId);

  // Clear pendingExecutionId once the execution appears in the fetched list
  useEffect(() => {
    if (
      pendingExecutionId &&
      executions.some((e) => (e.metadata?.id ?? "") === pendingExecutionId)
    ) {
      setPendingExecutionId(null);
    }
  }, [pendingExecutionId, executions]);

  // Clear optimistic message once the stream delivers its first snapshot
  useEffect(() => {
    if (pendingUserMessage && stream.execution) {
      setPendingUserMessage(null);
    }
  }, [pendingUserMessage, stream.execution]);

  const completedExecutions = useMemo(() => {
    if (!activeExecutionId) return executions;
    return executions.filter(
      (e) => (e.metadata?.id ?? "") !== activeExecutionId,
    );
  }, [executions, activeExecutionId]);

  const fetchedActiveExecution = useMemo(() => {
    if (!activeExecutionId) return null;
    return (
      executions.find(
        (e) => (e.metadata?.id ?? "") === activeExecutionId,
      ) ?? null
    );
  }, [executions, activeExecutionId]);

  const activeStreamExecution = stream.execution ?? fetchedActiveExecution;

  const activePhase = useMemo<ExecutionPhase | null>(() => {
    if (!activeExecutionId) return null;
    return stream.phase;
  }, [activeExecutionId, stream.phase]);

  const canSendFollowUp = !isCreating && activeExecutionId === null;

  const sendFollowUp = useCallback(
    async (message: string, modelName?: string): Promise<void> => {
      if (!sessionId) return;

      setPendingUserMessage(message);

      try {
        const result = await create({
          org,
          sessionId,
          message,
          modelName,
        });
        setPendingExecutionId(result.executionId);
        refetch();
      } catch {
        setPendingUserMessage(null);
      }
    },
    [sessionId, org, create, refetch],
  );

  const isLoading = sessionLoading || executionsLoading;
  const loadError = sessionError || executionsError;

  return {
    session,
    completedExecutions,
    activeStreamExecution,
    activePhase,
    isStreaming: stream.isStreaming,

    sendFollowUp,
    canSendFollowUp,
    isSending: isCreating,
    sendError: createError,
    clearSendError: clearCreateError,

    pendingUserMessage,

    isLoading,
    loadError,

    streamError: stream.error,
    reconnectStream: stream.reconnect,
  };
}
