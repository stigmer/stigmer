"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction, type ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { WorkspaceEntry as ProtoWorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { WorkspaceEntryInput } from "@stigmer/sdk";
import { isTerminalPhase } from "../execution/execution-phases";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution";
import { useExecutionStream } from "../execution/useExecutionStream";
import { useSubmitApproval } from "../execution/useSubmitApproval";
import { useSession } from "./useSession";
import { useSessionExecutions } from "./useSessionExecutions";
import { useUpdateSession } from "./useUpdateSession";

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

  /**
   * Submit a follow-up message. Internally creates an execution and
   * starts streaming it.
   *
   * When `workspaceEntries` is provided, the session's workspace list
   * is updated via `session.update()` before creating the execution.
   */
  readonly sendFollowUp: (
    message: string,
    modelName?: string,
    workspaceEntries?: WorkspaceEntryInput[],
  ) => Promise<void>;
  /** True when the input should be enabled (no active execution, not creating). */
  readonly canSendFollowUp: boolean;
  /** True during the create RPC call (between submit and execution ID). */
  readonly isSending: boolean;
  /** Error from the last sendFollowUp attempt, or null. */
  readonly sendError: string | null;
  readonly clearSendError: () => void;

  /** The user's message text, shown in the thread before the stream delivers it. */
  readonly pendingUserMessage: string | null;

  /** Current workspace entries from the session spec. Empty array when session is not loaded. */
  readonly workspaceEntries: readonly ProtoWorkspaceEntry[];

  /** Pending approval requests from the active execution, empty when none. */
  readonly pendingApprovals: readonly PendingApproval[];
  /** Submit an approval decision. The executionId is managed internally. */
  readonly submitApproval: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  /** Set of tool call IDs currently being submitted for approval. */
  readonly submittingApprovalIds: ReadonlySet<string>;
  /**
   * Tool call IDs that have been submitted and should be hidden from
   * the approval UI. Pass to {@link MessageThread.dismissedApprovalIds}
   * for optimistic removal.
   */
  readonly dismissedApprovalIds: ReadonlySet<string>;
  readonly approvalError: string | null;
  readonly clearApprovalError: () => void;

  readonly isLoading: boolean;
  readonly loadError: string | null;

  readonly streamError: string | null;
  readonly reconnectStream: () => void;
}

/**
 * Behavior hook that encapsulates the full conversation lifecycle for
 * a session: loading data, streaming the active execution, submitting
 * follow-up messages, and updating session-level workspace entries.
 *
 * Composes {@link useSession}, {@link useSessionExecutions},
 * {@link useCreateAgentExecution}, {@link useExecutionStream}, and
 * {@link useUpdateSession} into a single return value that drives
 * both {@link MessageThread} and {@link SessionComposer}.
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
 *         onApprovalSubmit={conv.submitApproval}
 *         submittingApprovalIds={conv.submittingApprovalIds}
 *         dismissedApprovalIds={conv.dismissedApprovalIds}
 *       />
 *       <SessionComposer
 *         onSubmit={(msg, model) => conv.sendFollowUp(msg, model)}
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
  const { update: updateSession } = useUpdateSession();
  const {
    submitApproval: rawSubmitApproval,
    submittingToolCallIds,
    error: approvalError,
    clearError: clearApprovalError,
  } = useSubmitApproval();

  const [pendingExecutionId, setPendingExecutionId] = useState<string | null>(
    null,
  );
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );
  const [dismissedApprovalIds, setDismissedApprovalIds] = useState<
    ReadonlySet<string>
  >(new Set());

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

  useEffect(() => {
    setDismissedApprovalIds(new Set());
  }, [activeExecutionId]);

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

  // Refetch executions when stream reaches a terminal phase so the
  // fetched list reflects the completed status and listActiveId clears.
  useEffect(() => {
    if (activeExecutionId && isTerminalPhase(stream.phase)) {
      refetch();
    }
  }, [activeExecutionId, stream.phase, refetch]);

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

  const workspaceEntries = useMemo<readonly ProtoWorkspaceEntry[]>(
    () => session?.spec?.workspaceEntries ?? [],
    [session],
  );

  const sendFollowUp = useCallback(
    async (
      message: string,
      modelName?: string,
      newWorkspaceEntries?: WorkspaceEntryInput[],
    ): Promise<void> => {
      if (!sessionId || !session) return;

      setPendingUserMessage(message);

      try {
        if (newWorkspaceEntries) {
          await updateSession(
            buildUpdateInput(session, newWorkspaceEntries),
          );
        }

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
    [sessionId, session, org, create, updateSession, refetch],
  );

  const pendingApprovals = useMemo<readonly PendingApproval[]>(() => {
    const all = activeStreamExecution?.status?.pendingApprovals ?? [];
    if (dismissedApprovalIds.size === 0) return all;
    return all.filter((a) => !dismissedApprovalIds.has(a.toolCallId));
  }, [activeStreamExecution, dismissedApprovalIds]);

  const submitApproval = useCallback(
    async (
      toolCallId: string,
      action: ApprovalAction,
      comment?: string,
    ): Promise<void> => {
      if (!activeExecutionId) return;
      await rawSubmitApproval(activeExecutionId, toolCallId, action, comment);
      setDismissedApprovalIds((prev) => {
        const next = new Set(prev);
        next.add(toolCallId);
        return next;
      });
    },
    [activeExecutionId, rawSubmitApproval],
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

    workspaceEntries,

    pendingApprovals,
    submitApproval,
    submittingApprovalIds: submittingToolCallIds,
    dismissedApprovalIds,
    approvalError,
    clearApprovalError,

    isLoading,
    loadError,

    streamError: stream.error,
    reconnectStream: stream.reconnect,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts the existing Session proto into a SessionInput with workspace
 * entries replaced. Preserves all other spec fields to avoid data loss
 * during the update RPC (which uses replace semantics).
 */
function buildUpdateInput(
  session: Session,
  workspaceEntries: WorkspaceEntryInput[],
) {
  const meta = session.metadata!;
  const spec = session.spec;

  const mcpServerUsages = spec?.mcpServerUsages?.map((u) => ({
    mcpServerRef: {
      org: u.mcpServerRef?.org ?? "",
      slug: u.mcpServerRef?.slug ?? "",
      version: u.mcpServerRef?.version || undefined,
      kind: u.mcpServerRef?.kind,
    },
    enabledTools: u.enabledTools?.length ? [...u.enabledTools] : undefined,
    toolApprovalOverrides: u.toolApprovalOverrides?.length
      ? u.toolApprovalOverrides.map((o) => ({
          toolName: o.toolName || undefined,
          requiresApproval: o.requiresApproval || undefined,
          message: o.message || undefined,
        }))
      : undefined,
  }));

  const skillRefs = spec?.skillRefs?.map((r) => ({
    org: r.org ?? "",
    slug: r.slug ?? "",
    version: r.version || undefined,
    kind: r.kind,
  }));

  return {
    name: meta.name,
    org: meta.org,
    agentInstanceId: spec?.agentInstanceId || undefined,
    subject: spec?.subject || undefined,
    threadId: spec?.threadId || undefined,
    sandboxId: spec?.sandboxId || undefined,
    metadata: spec?.metadata && Object.keys(spec.metadata).length > 0
      ? { ...spec.metadata }
      : undefined,
    workspaceEntries,
    mcpServerUsages: mcpServerUsages?.length ? mcpServerUsages : undefined,
    skillRefs: skillRefs?.length ? skillRefs : undefined,
  };
}
