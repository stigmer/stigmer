"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { ApprovalAction, ExecutionPhase, FileChangeSetStatus, FileDecisionAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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
import { isTerminalPhase } from "../execution/execution-phases.js";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useConversationStoreRef } from "../internal/store/index.js";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution.js";
import { useExecutionStream } from "../execution/useExecutionStream.js";
import { useAgentExecutionActions } from "../execution/useAgentExecutionActions.js";
import { useSubmitApproval } from "../execution/useSubmitApproval.js";
import { useFileReview, type FileDecisionOptions } from "../execution/useFileReview.js";
import { useSession } from "./useSession.js";
import { useSessionExecutions } from "./useSessionExecutions.js";
import { useUpdateSession } from "./useUpdateSession.js";
import { useLocalSessionWorker } from "./useLocalSessionWorker.js";
import {
  specWorkspaceToInput,
  specMcpUsagesToInput,
  specSkillRefsToInput,
} from "./session-spec-converters.js";

/**
 * Cadence for re-discovering the session's executions while the live stream
 * cannot be relied on (a created-but-not-yet-listed execution, a silent
 * connect-timeout, or an exhausted stream error). Disabled the instant the
 * stream is healthy or terminal, so this never competes with the live feed.
 */
const REDISCOVERY_POLL_INTERVAL_MS = 5_000;

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
   * Marks this execution as a Build-from-plan turn.
   *
   * @see {@link CreateAgentExecutionInput.buildFromPlan}
   */
  readonly buildFromPlan?: boolean;
  /**
   * Auto-approve every tool call for this execution (bypass the HITL gate).
   *
   * @see {@link CreateAgentExecutionInput.autoApproveAll}
   */
  readonly autoApproveAll?: boolean;
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
  /**
   * Error from the last `sendFollowUp` attempt, or `null`.
   *
   * Covers **both** failing paths — the optional `session.update()` and the
   * `create()` RPC — so a follow-up never fails silently. When set, the user's
   * message is preserved (see {@link pendingUserMessage}) and can be re-sent
   * via {@link retryLastSend}.
   */
  readonly sendError: Error | null;
  /** Reset `sendError` to `null` (keeps the preserved pending message). */
  readonly clearSendError: () => void;
  /**
   * Re-send the most recent `sendFollowUp` (same message and options). No-op
   * when nothing has been sent yet. Use as the "Retry" affordance on a failed
   * turn; clears {@link sendError} for the new attempt.
   */
  readonly retryLastSend: () => void;

  /**
   * The user's message text, shown in the thread before the stream delivers it.
   * Retained when a send fails so the typed message is never lost — pair with
   * {@link sendError} to render the turn as failed with a retry control.
   */
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
   * Per-tool-call approval failures, keyed by `toolCallId` — surfaced in-card by
   * {@link MessageThread}/{@link ApprovalCard} beside the gate that failed
   * (inline row or bottom backstop). The keyed parallel of
   * {@link submittingApprovalIds}.
   */
  readonly approvalErrors: ReadonlyMap<string, Error>;
  /**
   * Error from the last approval submission, or `null` when healthy — the scalar
   * mirror of {@link approvalErrors} (symmetric with `fileReviewError`), for a
   * headless consumer wanting a single error value (e.g. the `ink` surface).
   */
  readonly approvalError: Error | null;
  /** Reset every approval error (both {@link approvalErrors} and `approvalError`). */
  readonly clearApprovalError: () => void;

  /** Captured change sets awaiting file review on the active execution, empty when none. */
  readonly fileChangeSets: readonly FileChangeSet[];
  /** Submit a file-review decision for a change set. The executionId is managed internally. */
  readonly submitFileDecision: (
    changeSetId: string,
    action: FileDecisionAction,
    options?: FileDecisionOptions,
  ) => Promise<void>;
  /** Decision keys ({@link fileDecisionKey}) currently being submitted. */
  readonly submittingFileDecisionKeys: ReadonlySet<string>;
  /**
   * Per-decision failures, keyed by {@link fileDecisionKey} — surfaced in-card
   * by {@link MessageThread}/{@link FileReviewCard} beside the failed control.
   */
  readonly fileDecisionErrors: ReadonlyMap<string, Error>;
  /** Clear the error for one decision key (e.g. before a retry of that target). */
  readonly clearFileDecisionError: (key: string) => void;
  /**
   * The most-recent file-review failure, or `null` when healthy — the scalar
   * mirror of {@link fileDecisionErrors} (symmetric with `approvalError`), for a
   * headless consumer wanting a single error value.
   */
  readonly fileReviewError: Error | null;
  /** Reset every file-review error (both {@link fileDecisionErrors} and `fileReviewError`). */
  readonly clearFileReviewError: () => void;

  /**
   * `true` when the active execution can be stopped — i.e. it is in a phase
   * the backend accepts a cancel/terminate from (`PENDING` or `IN_PROGRESS`).
   *
   * Distinct from "is something active": an execution paused at an approval
   * gate (`WAITING_FOR_APPROVAL`) is active but **not** stoppable — the
   * approval card (approve / skip / reject) is its control surface. Drive the
   * composer's Stop affordance off this so it only appears when {@link stop}
   * will actually succeed.
   */
  readonly isStoppable: boolean;
  /**
   * Stop the active execution, with progressive escalation: the first call
   * gracefully cancels; a repeat call (because the run is still winding down)
   * forcefully terminates. No-op when nothing is {@link isStoppable}.
   */
  readonly stop: (reason?: string) => Promise<void>;
  /** `true` while a stop (cancel/terminate) request is in flight. */
  readonly isStopping: boolean;
  /** Error from the last stop attempt, or `null` when healthy. */
  readonly stopError: Error | null;

  /** `true` while the session or execution list is loading. */
  readonly isLoading: boolean;
  /** Error from session or execution list loading, or `null` when healthy. */
  readonly loadError: Error | null;

  /**
   * `true` while the execution stream is auto-reconnecting after a transient
   * drop. The conversation stays visible and `streamError` remains `null` —
   * surface a subtle "Reconnecting…" hint rather than an error banner.
   */
  readonly isReconnecting: boolean;
  /**
   * `true` when the stream opened but never delivered a first snapshot within
   * the watchdog window (even after a silent retry) — the agent hasn't started.
   * Distinct from `streamError`: nothing threw, the stream is simply silent.
   * Surface an actionable "the agent hasn't started — Retry" banner wired to
   * {@link reconnectStream}.
   */
  readonly connectTimedOut: boolean;
  /**
   * `true` when a live, non-terminal stream has been silent past the slow
   * threshold. Purely informational ("still working — taking longer than
   * usual"); cleared by the next update. Never an error.
   */
  readonly isSlow: boolean;
  /** Error from the execution stream, or `null` when healthy or reconnecting. */
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
 * For local execution, this hook also owns the session's runner worker
 * lifecycle: while the session is open it keeps a worker polling the
 * session task queue, and it tears the worker down on close. This is a
 * no-op unless a `runnerAdapter` is configured and the session runs
 * locally, so it is safe in every environment.
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
  // Bounded re-discovery (see REDISCOVERY_POLL_INTERVAL_MS). The gate depends on
  // the stream below, so the decision is synced into state via an effect and fed
  // back here on the next render — a one-frame lag that is immaterial at 5s.
  const [rediscoveryActive, setRediscoveryActive] = useState(false);
  const {
    executions,
    isLoading: executionsLoading,
    error: executionsError,
    refetch,
  } = useSessionExecutions(sessionId, {
    refetchInterval: rediscoveryActive ? REDISCOVERY_POLL_INTERVAL_MS : false,
    // Re-list on app-relaunch / tab refocus so an execution that appeared while
    // backgrounded is picked up without the user having to act.
    refetchOnWindowFocus: true,
  });
  const {
    create,
    isCreating,
    clearError: clearCreateError,
  } = useCreateAgentExecution();
  const { update: updateSession } = useUpdateSession();
  const {
    submitApproval: rawSubmitApproval,
    submittingToolCallIds,
    errorsByToolCallId: approvalErrors,
    error: approvalError,
    clearError: clearApprovalError,
  } = useSubmitApproval();
  const {
    submitFileDecision: rawSubmitFileDecision,
    submittingDecisionKeys,
    decisionErrors: fileDecisionErrors,
    clearDecisionError: clearFileDecisionError,
    error: fileReviewError,
    clearError: clearFileReviewError,
  } = useFileReview();

  // Local execution: attach the session's runner worker while it is open and
  // detach it on close. No-op for cloud sessions or when no adapter is set.
  useLocalSessionWorker(sessionId, session);

  const [pendingExecutionId, setPendingExecutionId] = useState<string | null>(
    null,
  );
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );
  // Dedicated send-failure state, distinct from the create hook's internal
  // error so it can also cover the session.update() path. The last send's
  // arguments are captured for an exact retry.
  const [sendError, setSendError] = useState<Error | null>(null);
  const lastSendRef = useRef<{
    message: string;
    options?: SendFollowUpOptions;
  } | null>(null);

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

  // Re-discovery gate. Poll only while the live stream cannot carry us:
  //  • a fresh session whose first execution is created but not yet listed
  //    (`executions.length === 0`) — the race this fix targets,
  //  • a silent connect-timeout, or an exhausted stream error.
  // Never while the stream is healthy (`isStreaming`) or the active execution
  // has reached a terminal phase — the live feed is then the source of truth.
  const streamTerminal =
    activeExecutionId !== null && isTerminalPhase(stream.phase);
  const needsRediscovery =
    !stream.isStreaming &&
    !streamTerminal &&
    ((activeExecutionId === null && executions.length === 0) ||
      stream.connectTimedOut ||
      stream.error !== null);

  useEffect(() => {
    setRediscoveryActive(needsRediscovery);
  }, [needsRediscovery]);

  // Clear pendingExecutionId once the execution appears in the fetched list
  useEffect(() => {
    if (
      pendingExecutionId &&
      executions.some((e) => (e.metadata?.id ?? "") === pendingExecutionId)
    ) {
      setPendingExecutionId(null);
    }
  }, [pendingExecutionId, executions]);

  // Clear the optimistic message — and any stale send error — once the stream
  // delivers a real snapshot. This also handles recovery: if a failed send's
  // execution is later re-discovered and streams, the failed turn resolves into
  // the live one instead of lingering. (At send time the composer is only
  // enabled when no execution is active, so a *fresh* failure cannot be cleared
  // here prematurely — `stream.execution` is null then.)
  useEffect(() => {
    if (!stream.execution) return;
    if (pendingUserMessage) setPendingUserMessage(null);
    if (sendError) setSendError(null);
  }, [pendingUserMessage, sendError, stream.execution]);

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

  // Stop is only valid in phases the backend cancels/terminates from
  // (PENDING / IN_PROGRESS). Other non-terminal phases (e.g.
  // WAITING_FOR_APPROVAL) are handled by their own control surface.
  const isStoppable =
    activePhase === ExecutionPhase.EXECUTION_PENDING ||
    activePhase === ExecutionPhase.EXECUTION_IN_PROGRESS;

  const stopActions = useAgentExecutionActions(activeExecutionId, {
    // The cancel/terminate also broadcasts the new phase over the stream, but
    // refetch is the belt-and-suspenders that clears the active id even if the
    // stream has already ended — mirrors the workflow viewer's onSuccess.
    onSuccess: refetch,
  });

  const stop = useCallback(
    async (reason?: string): Promise<void> => {
      if (!isStoppable) return;
      await stopActions.stop(reason);
    },
    [isStoppable, stopActions.stop],
  );

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

      // Capture for retry and clear any prior failure before the new attempt.
      lastSendRef.current = { message, options };
      setSendError(null);
      // A Build-from-plan turn shows no optimistic bubble: its message is a
      // machine-written label, not user prose, and the thread hides the turn
      // entirely (the plan card's "Starting build…" state covers the send
      // window). It is still set on FAILURE below, so a failed build send
      // renders the failed-with-retry bubble instead of vanishing.
      if (!options?.buildFromPlan) {
        setPendingUserMessage(message);
      }

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
          buildFromPlan: options?.buildFromPlan,
          autoApproveAll: options?.autoApproveAll,
          workspaceFileRefs: options?.workspaceFileRefs,
        });
        setPendingExecutionId(result.executionId);
        refetch();
      } catch (err) {
        // Surface the failure and KEEP the user's message visible (do not clear
        // pendingUserMessage) so the turn renders as failed-with-retry instead
        // of vanishing. Covers both the update() and create() paths. For a
        // build turn this is the FIRST time the message is set — failure is
        // the one case where its label must become visible.
        setPendingUserMessage(message);
        setSendError(toError(err));
        if (process.env.NODE_ENV !== "production") {
          console.error("[useSessionConversation] sendFollowUp failed:", err);
        }
      }
    },
    [sessionId, session, org, stigmer, create, updateSession, refetch, refetchSession],
  );

  const retryLastSend = useCallback(() => {
    const last = lastSendRef.current;
    if (last) void sendFollowUp(last.message, last.options);
  }, [sendFollowUp]);

  const clearSendError = useCallback(() => {
    setSendError(null);
    clearCreateError();
  }, [clearCreateError]);

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

  const fileChangeSets = useMemo<readonly FileChangeSet[]>(
    () =>
      (activeStreamExecution?.status?.fileChangeSets ?? []).filter(
        (cs) => cs.status === FileChangeSetStatus.AWAITING_REVIEW,
      ),
    [activeStreamExecution],
  );

  const submitFileDecision = useCallback(
    async (
      changeSetId: string,
      action: FileDecisionAction,
      options?: FileDecisionOptions,
    ): Promise<void> => {
      if (!activeExecutionId) return;
      await rawSubmitFileDecision(activeExecutionId, changeSetId, action, options);
    },
    [activeExecutionId, rawSubmitFileDecision],
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
    sendError,
    clearSendError,
    retryLastSend,

    pendingUserMessage,

    workspaceEntries,
    mcpServerUsages,
    skillRefs,

    pendingApprovals,
    submitApproval,
    submittingApprovalIds: submittingToolCallIds,
    approvalErrors,
    approvalError,
    clearApprovalError,

    fileChangeSets,
    submitFileDecision,
    submittingFileDecisionKeys: submittingDecisionKeys,
    fileDecisionErrors,
    clearFileDecisionError,
    fileReviewError,
    clearFileReviewError,

    isStoppable,
    stop,
    isStopping: stopActions.isSubmitting,
    stopError: stopActions.error,

    isLoading,
    loadError,

    isReconnecting: stream.isReconnecting,
    connectTimedOut: stream.connectTimedOut,
    isSlow: stream.isSlow,
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

