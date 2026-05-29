"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { McpServerUsage as ProtoMcpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { WorkspaceEntry as ProtoWorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { ApiResourceReference as ProtoApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type {
  AttachmentInput,
  EnvVarInput,
  McpServerUsageInput,
  ResourceRef,
  WorkspaceEntryInput,
} from "@stigmer/sdk";
import { isTerminalPhase } from "../execution/execution-phases";
import { useStigmer } from "../hooks";
import { useConversationStoreRef } from "../internal/store";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution";
import { useExecutionStream } from "../execution/useExecutionStream";
import { useSubmitApproval } from "../execution/useSubmitApproval";
import { useSession } from "./useSession";
import { useSessionExecutions } from "./useSessionExecutions";
import { useUpdateSession } from "./useUpdateSession";
import {
  specWorkspaceToInput,
  specMcpUsagesToInput,
  specSkillRefsToInput,
} from "./session-spec-converters";

/**
 * Options for {@link UseSessionConversationReturn.sendFollowUp}.
 *
 * Session-level fields (`workspaceEntries`, `mcpServerUsages`,
 * `skillRefs`) trigger a `session.update()` before the execution is
 * created. Only provided fields are overwritten; omitted fields
 * preserve the session's existing values.
 *
 * `runtimeEnv` is forwarded to the execution (Execution Flow). These
 * values are scoped to the single execution and deleted on completion.
 */
export interface SendFollowUpOptions {
  /** LLM model name to use for this execution. Overrides the session default. */
  readonly modelName?: string;
  /**
   * Override the session's agent instance for this and all future
   * executions. When provided, the session is updated before the
   * execution is created.
   */
  readonly agentInstanceId?: string;
  /** Workspace entries to attach to the execution. */
  readonly workspaceEntries?: WorkspaceEntryInput[];
  /** MCP server configurations to include for tool access. */
  readonly mcpServerUsages?: McpServerUsageInput[];
  /** Skill references to enable for this execution. */
  readonly skillRefs?: ResourceRef[];
  /**
   * Execution-scoped secrets and configuration (Execution Flow).
   *
   * Values are injected into the agent sandbox for this execution only
   * and deleted when the execution completes. They override both
   * Environment values and agent defaults.
   *
   * @see {@link CreateAgentExecutionInput.runtimeEnv}
   */
  readonly runtimeEnv?: Record<string, EnvVarInput>;
  /**
   * Pre-uploaded file attachments for this execution.
   *
   * Each entry must include a `storageKey` from
   * `agentExecution.uploadAttachment()`. Forwarded directly to
   * execution creation.
   *
   * @see {@link CreateAgentExecutionInput.attachments}
   */
  readonly attachments?: AttachmentInput[];
  /**
   * Interaction mode for this execution.
   *
   * - `"agent"` (default): full tool access.
   * - `"plan"`: read-only analysis, no file mutations.
   */
  readonly interactionMode?: "agent" | "plan";
  /**
   * Workspace-relative file paths the user wants the agent to focus on.
   *
   * Lightweight "attention" signals — no upload, no injection. The agent
   * reads these files directly from the workspace filesystem.
   *
   * @see {@link CreateAgentExecutionInput.workspaceFileRefs}
   */
  readonly workspaceFileRefs?: string[];
}

/**
 * Return value of {@link useSessionConversation}.
 *
 * Provides the full conversation state for a session: loaded data,
 * active stream, follow-up submission, approval handling, and
 * session-level context (workspace entries, MCP servers, skills).
 */
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
   * True after the stream subscription starts but before the first
   * snapshot arrives from the server. Platform builders can use this
   * to differentiate between "connecting to stream" and "execution is
   * PENDING but stream is established."
   */
  readonly isConnecting: boolean;

  /**
   * Submit a follow-up message. Internally creates an execution and
   * starts streaming it.
   *
   * When session-level fields (`agentInstanceId`, `workspaceEntries`,
   * `mcpServerUsages`, `skillRefs`) are provided in options, the
   * session is updated via `session.update()` before creating the
   * execution.
   */
  readonly sendFollowUp: (
    message: string,
    options?: SendFollowUpOptions,
  ) => Promise<void>;
  /** True when the input should be enabled (no active execution, not creating). */
  readonly canSendFollowUp: boolean;
  /** True during the create RPC call (between submit and execution ID). */
  readonly isSending: boolean;
  /** Error from the last sendFollowUp attempt, or null. */
  readonly sendError: Error | null;
  /** Reset `sendError` to `null`. */
  readonly clearSendError: () => void;

  /** The user's message text, shown in the thread before the stream delivers it. */
  readonly pendingUserMessage: string | null;

  /** Current workspace entries from the session spec. Empty array when session is not loaded. */
  readonly workspaceEntries: readonly ProtoWorkspaceEntry[];
  /** Current MCP server usages from the session spec. Empty array when session is not loaded. */
  readonly mcpServerUsages: readonly ProtoMcpServerUsage[];
  /** Current skill references from the session spec. Empty array when session is not loaded. */
  readonly skillRefs: readonly ProtoApiResourceReference[];

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
  /** Error from the last approval submission, or `null` when healthy. */
  readonly approvalError: Error | null;
  /** Reset `approvalError` to `null`. */
  readonly clearApprovalError: () => void;

  /** `true` while the session or execution list is loading. */
  readonly isLoading: boolean;
  /** Error from session or execution list loading, or `null` when healthy. */
  readonly loadError: Error | null;

  /** Error from the execution stream, or `null` when healthy. */
  readonly streamError: Error | null;
  /** Reset the stream error and re-establish the execution stream subscription. */
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
 *       />
 *       <SessionComposer
 *         onSubmit={(msg, model) => conv.sendFollowUp(msg, { modelName: model })}
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
  const stigmer = useStigmer();
  const {
    session,
    isLoading: sessionLoading,
    error: sessionError,
    refetch: refetchSession,
  } = useSession(sessionId);
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

  // The conversation store is shared between useExecutionStream (which
  // ingests snapshots with structural sharing + rAF coalescing) and the
  // rendering tree. This eliminates the duplicate structuralShare that
  // was previously done in this hook.
  const conversationStore = useConversationStoreRef();
  const stream = useExecutionStream(activeExecutionId, {
    store: conversationStore,
  });

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

  const activeStreamExecution =
    stream.execution ?? fetchedActiveExecution;

  const activePhase = useMemo<ExecutionPhase | null>(() => {
    if (!activeExecutionId) return null;
    return stream.phase;
  }, [activeExecutionId, stream.phase]);

  const canSendFollowUp = !isCreating && activeExecutionId === null;

  const workspaceEntries = useMemo<readonly ProtoWorkspaceEntry[]>(
    () => session?.spec?.workspaceEntries ?? [],
    [session],
  );

  const mcpServerUsages = useMemo<readonly ProtoMcpServerUsage[]>(
    () => session?.spec?.mcpServerUsages ?? [],
    [session],
  );

  const skillRefs = useMemo<readonly ProtoApiResourceReference[]>(
    () => session?.spec?.skillRefs ?? [],
    [session],
  );

  const sendFollowUp = useCallback(
    async (message: string, options?: SendFollowUpOptions): Promise<void> => {
      if (!sessionId || !session) return;

      setPendingUserMessage(message);

      try {
        const needsSessionUpdate =
          options?.agentInstanceId !== undefined ||
          options?.workspaceEntries !== undefined ||
          options?.mcpServerUsages !== undefined ||
          options?.skillRefs !== undefined;

        if (needsSessionUpdate) {
          // Fetch the latest session to avoid overwriting fields that were
          // modified server-side (e.g., LLM-generated subject)
          // since the React state was last loaded.
          const freshSession = await stigmer.session.get(sessionId);
          await updateSession(
            buildUpdateInput(freshSession, {
              agentInstanceId: options?.agentInstanceId,
              workspaceEntries: options?.workspaceEntries,
              mcpServerUsages: options?.mcpServerUsages,
              skillRefs: options?.skillRefs,
            }),
          );
          refetchSession();
        }

        const result = await create({
          org,
          sessionId,
          message,
          modelName: options?.modelName,
          runtimeEnv: options?.runtimeEnv,
          attachments: options?.attachments,
          interactionMode: options?.interactionMode,
          workspaceFileRefs: options?.workspaceFileRefs,
        });
        setPendingExecutionId(result.executionId);
        refetch();
      } catch (err) {
        setPendingUserMessage(null);
        if (process.env.NODE_ENV !== "production") {
          console.error("[useSessionConversation] sendFollowUp failed:", err);
        }
      }
    },
    [sessionId, session, org, stigmer, create, updateSession, refetch, refetchSession],
  );

  const pendingApprovals = useMemo<readonly PendingApproval[]>(
    () => activeStreamExecution?.status?.pendingApprovals ?? [],
    [activeStreamExecution],
  );

  const submitApproval = useCallback(
    async (
      toolCallId: string,
      action: ApprovalAction,
      comment?: string,
    ): Promise<void> => {
      if (!activeExecutionId) return;
      await rawSubmitApproval(activeExecutionId, toolCallId, action, comment);
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
    isConnecting: stream.isConnecting,

    sendFollowUp,
    canSendFollowUp,
    isSending: isCreating,
    sendError: createError,
    clearSendError: clearCreateError,

    pendingUserMessage,

    workspaceEntries,
    mcpServerUsages,
    skillRefs,

    pendingApprovals,
    submitApproval,
    submittingApprovalIds: submittingToolCallIds,
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
 * Converts the existing Session proto into a SessionInput suitable for
 * the update RPC (which uses replace semantics — the full spec is sent).
 *
 * For each session-level collection (workspace, MCP servers, skills):
 * if an override is provided, it replaces the existing value; otherwise
 * the current session value is preserved by converting it back to input
 * format.
 */
function buildUpdateInput(
  session: Session,
  overrides: {
    agentInstanceId?: string;
    workspaceEntries?: WorkspaceEntryInput[];
    mcpServerUsages?: McpServerUsageInput[];
    skillRefs?: ResourceRef[];
  },
) {
  const meta = session.metadata!;
  const spec = session.spec;

  const workspaceEntries =
    overrides.workspaceEntries ?? specWorkspaceToInput(spec);

  const mcpServerUsages =
    overrides.mcpServerUsages ?? specMcpUsagesToInput(spec);

  const skillRefs = overrides.skillRefs ?? specSkillRefsToInput(spec);

  return {
    name: meta.name,
    org: meta.org,
    agentInstanceId: overrides.agentInstanceId ?? (spec?.agentInstanceId || undefined),
    subject: spec?.subject || undefined,
    harnessStateId: spec?.harnessStateId || undefined,
    harness: spec?.harness,
    cursorMode: spec?.cursorMode,
    executionTarget: spec?.executionTarget,
    metadata:
      spec?.metadata && Object.keys(spec.metadata).length > 0
        ? { ...spec.metadata }
        : undefined,
    workspaceEntries: workspaceEntries?.length ? workspaceEntries : undefined,
    mcpServerUsages: mcpServerUsages?.length ? mcpServerUsages : undefined,
    skillRefs: skillRefs?.length ? skillRefs : undefined,
  };
}

