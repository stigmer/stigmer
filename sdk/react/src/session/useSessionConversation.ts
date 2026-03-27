"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution";
import { useExecutionStream } from "../execution/useExecutionStream";
import { useSubmitApproval } from "../execution/useSubmitApproval";
import { useSession } from "./useSession";
import { useSessionExecutions } from "./useSessionExecutions";
import { useUpdateSession } from "./useUpdateSession";

const APPROVAL_POLL_INITIAL_MS = 3_000;
const APPROVAL_POLL_MAX_MS = 30_000;
const STALE_DISMISSAL_MS = 15_000;
const STALE_CHECK_INTERVAL_MS = 5_000;

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
  readonly modelName?: string;
  /**
   * Override the session's agent instance for this and all future
   * executions. When provided, the session is updated before the
   * execution is created.
   */
  readonly agentInstanceId?: string;
  readonly workspaceEntries?: WorkspaceEntryInput[];
  readonly mcpServerUsages?: McpServerUsageInput[];
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
}

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
  /**
   * Tool call IDs that have been submitted and should be hidden from
   * the approval UI. Pass to {@link MessageThread.dismissedApprovalIds}
   * for optimistic removal.
   */
  readonly dismissedApprovalIds: ReadonlySet<string>;
  readonly approvalError: Error | null;
  readonly clearApprovalError: () => void;

  readonly isLoading: boolean;
  readonly loadError: Error | null;

  readonly streamError: Error | null;
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
  const [dismissedAtMap, setDismissedAtMap] = useState<
    ReadonlyMap<string, number>
  >(new Map());
  const dismissedAtMapRef = useRef(dismissedAtMap);
  dismissedAtMapRef.current = dismissedAtMap;

  const dismissedApprovalIds = useMemo<ReadonlySet<string>>(
    () => new Set(dismissedAtMap.keys()),
    [dismissedAtMap],
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

  useEffect(() => {
    setDismissedAtMap(new Map());
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
          // modified server-side (e.g., LLM-generated subject, sandbox_id)
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
        });
        setPendingExecutionId(result.executionId);
        refetch();
      } catch {
        setPendingUserMessage(null);
      }
    },
    [sessionId, session, org, stigmer, create, updateSession, refetch, refetchSession],
  );

  const pendingApprovals = useMemo<readonly PendingApproval[]>(() => {
    const all = activeStreamExecution?.status?.pendingApprovals ?? [];
    if (dismissedApprovalIds.size === 0) return all;
    return all.filter((a) => !dismissedApprovalIds.has(a.toolCallId));
  }, [activeStreamExecution, dismissedApprovalIds]);

  // Poll-based fallback: when the execution is WAITING_FOR_APPROVAL but
  // the server has not delivered any approval data (raw approvals empty),
  // refetch with exponential backoff until data arrives. Checks raw
  // (unfiltered) approvals so dismissed-but-present approvals don't
  // trigger unnecessary network requests — that case is handled by the
  // staleness detection below.
  const rawApprovalCount =
    activeStreamExecution?.status?.pendingApprovals?.length ?? 0;

  const approvalPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptRef = useRef(0);

  useEffect(() => {
    if (approvalPollRef.current) {
      clearTimeout(approvalPollRef.current);
      approvalPollRef.current = null;
    }
    pollAttemptRef.current = 0;

    const isWaiting =
      activePhase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;

    if (!isWaiting || rawApprovalCount > 0 || !activeExecutionId) return;

    function scheduleNextPoll() {
      const delay = Math.min(
        APPROVAL_POLL_INITIAL_MS * 2 ** pollAttemptRef.current,
        APPROVAL_POLL_MAX_MS,
      );
      approvalPollRef.current = setTimeout(() => {
        pollAttemptRef.current += 1;
        refetch();
        scheduleNextPoll();
      }, delay);
    }

    scheduleNextPoll();

    return () => {
      if (approvalPollRef.current) {
        clearTimeout(approvalPollRef.current);
        approvalPollRef.current = null;
      }
    };
  }, [activePhase, rawApprovalCount, activeExecutionId, refetch]);

  // Staleness detection: when an approval was optimistically dismissed
  // but the execution remains in WAITING_FOR_APPROVAL longer than
  // expected, the downstream Temporal signal may have failed. Remove
  // stale dismissals so the card reappears and the user can retry.
  useEffect(() => {
    const isWaiting =
      activePhase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL;
    if (!isWaiting || dismissedAtMap.size === 0) return;

    const id = setInterval(() => {
      const now = Date.now();
      const currentMap = dismissedAtMapRef.current;
      const staleKeys: string[] = [];
      for (const [key, ts] of currentMap) {
        if (now - ts > STALE_DISMISSAL_MS) staleKeys.push(key);
      }
      if (staleKeys.length === 0) return;

      setDismissedAtMap((prev) => {
        const next = new Map(prev);
        for (const key of staleKeys) next.delete(key);
        return next.size < prev.size ? next : prev;
      });
      refetch();
    }, STALE_CHECK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [activePhase, dismissedAtMap.size, refetch]);

  const submitApproval = useCallback(
    async (
      toolCallId: string,
      action: ApprovalAction,
      comment?: string,
    ): Promise<void> => {
      if (!activeExecutionId) return;
      await rawSubmitApproval(activeExecutionId, toolCallId, action, comment);
      setDismissedAtMap((prev) => {
        const next = new Map(prev);
        next.set(toolCallId, Date.now());
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
    threadId: spec?.threadId || undefined,
    sandboxId: spec?.sandboxId || undefined,
    metadata:
      spec?.metadata && Object.keys(spec.metadata).length > 0
        ? { ...spec.metadata }
        : undefined,
    workspaceEntries: workspaceEntries?.length ? workspaceEntries : undefined,
    mcpServerUsages: mcpServerUsages?.length ? mcpServerUsages : undefined,
    skillRefs: skillRefs?.length ? skillRefs : undefined,
  };
}

/** Convert proto workspace entries back to SDK input format. */
function specWorkspaceToInput(
  spec: Session["spec"],
): WorkspaceEntryInput[] | undefined {
  return spec?.workspaceEntries?.map((e): WorkspaceEntryInput => {
    if (e.source?.source.case === "gitRepo") {
      const v = e.source.source.value;
      return {
        name: e.name || undefined,
        source: {
          gitRepo: {
            url: v.url,
            branch: v.branch || undefined,
            commit: v.commit || undefined,
            depth: v.depth || undefined,
          },
        },
      };
    }
    if (e.source?.source.case === "localPath") {
      return {
        name: e.name || undefined,
        source: {
          localPath: { path: e.source.source.value.path || undefined },
        },
      };
    }
    return { name: e.name || undefined, source: {} };
  });
}

/** Convert proto MCP server usages back to SDK input format. */
function specMcpUsagesToInput(
  spec: Session["spec"],
): McpServerUsageInput[] | undefined {
  return spec?.mcpServerUsages?.map((u) => ({
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
}

/** Convert proto skill references back to SDK input format. */
function specSkillRefsToInput(
  spec: Session["spec"],
): ResourceRef[] | undefined {
  return spec?.skillRefs?.map((r) => ({
    org: r.org ?? "",
    slug: r.slug ?? "",
    version: r.version || undefined,
    kind: r.kind,
  }));
}
