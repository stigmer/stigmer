"use client";

import { lazy, memo, Suspense, useCallback, useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { cn } from "@stigmer/theme";
import { isTerminalPhase } from "./execution-phases";
import { MessageEntry } from "./MessageEntry";
import { ToolCallGroup } from "./ToolCallGroup";
import { SubAgentSection } from "./SubAgentSection";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge";
import { SetupProgress } from "./SetupProgress";
import { ApprovalCard } from "./ApprovalCard";
import { SummarizationCard } from "./SummarizationCard";
import type { SummarizationEventView } from "./useContextWindow";
import { FilePathContext, type FilePathContextValue } from "./FilePathContext";
import type { ResolvedPathAction } from "./file-path-resolver";
import { SandboxContext, type SandboxContextValue } from "./SandboxContext";
import { useRenderTracer, useKeyStability, useDomNodeCount, DevProfiler } from "../internal/dev";
import { useAutoScroll } from "../internal/useAutoScroll";
import { JumpToLatestButton } from "../internal/JumpToLatestButton";
import { ThreadItemWrapper } from "../internal/ThreadItemWrapper";

const LazyVirtualizedThread = lazy(() =>
  import("../internal/VirtualizedThread").then((m) => ({
    default: m.VirtualizedThread,
  })),
);

/** Props for {@link MessageThread}. */
export interface MessageThreadProps {
  /** Completed executions in chronological order. */
  readonly executions: readonly AgentExecution[];
  /**
   * The currently streaming execution. Appended after `executions` to
   * form a continuous thread. Pass `null` or `undefined` when no
   * execution is actively streaming.
   */
  readonly activeStreamExecution?: AgentExecution | null;
  /**
   * Optimistic user message shown at the end of the thread before the
   * stream delivers the real message. Rendered as a human message with
   * a sending indicator. Clear this prop once the stream delivers its
   * first snapshot.
   */
  readonly pendingUserMessage?: string | null;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Custom formatter for tool call summary labels. Passed through to
   * each {@link ToolCallGroup}.
   */
  readonly formatToolCallSummary?: (toolCalls: readonly ToolCall[]) => string;
  /**
   * Callback for approval actions. When provided and the active
   * execution has pending approvals, {@link ApprovalCard}s are
   * rendered as thread items. When omitted, no approval UI is
   * shown (backward compatible).
   */
  readonly onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
  /**
   * Set of tool call IDs currently being submitted for approval.
   * Drives per-card loading state. Only meaningful when
   * `onApprovalSubmit` is provided.
   */
  readonly submittingApprovalIds?: ReadonlySet<string>;
  /**
   * Workspace entries from the session spec. When provided, file
   * paths in tool call rendering become interactive — git-sourced
   * paths open on GitHub, local paths offer copy-to-clipboard.
   *
   * Passed to {@link FilePathContext} for consumption by
   * {@link FilePathLink} components deep in the tree.
   */
  readonly workspaceEntries?: readonly WorkspaceEntry[];
  /**
   * Optional override for file path click behavior. Platform
   * builders use this to integrate their own file viewer or
   * navigation instead of the default open-URL / copy-to-clipboard.
   */
  readonly onFilePathClick?: (
    path: string,
    resolved: ResolvedPathAction,
  ) => void;
  /**
   * Absolute sandbox workspace root (e.g. `/home/daytona/workspace`).
   * When provided, shell commands and tool output normalize absolute
   * sandbox paths to workspace-relative display paths.
   *
   * Pass an empty string or omit for local sessions where paths are
   * the user's own filesystem (no normalization needed).
   */
  readonly sandboxWorkspaceRoot?: string;
  /**
   * Summarization events from context window tracking. When provided,
   * "Context compacted" cards are interleaved into the thread at the
   * correct chronological position based on event timestamps.
   *
   * Obtain from {@link useContextWindow}.summarizationEvents.
   */
  readonly summarizationEvents?: readonly SummarizationEventView[];
  /**
   * Enable virtualized rendering for long conversations. Requires
   * `react-virtuoso` to be installed as a peer dependency. When
   * enabled, only visible items are rendered in the DOM, improving
   * performance for threads with 100+ items.
   *
   * @default false
   */
  readonly virtualized?: boolean;
}

/**
 * Flattened representation of one renderable item in the thread.
 *
 * Discriminated union keeps the render loop a simple switch with no
 * type narrowing gymnastics.
 *
 * @internal Exported for internal use by `VirtualizedThread` — not
 * part of the public API.
 */
export type ThreadItem =
  | { readonly kind: "message"; readonly message: AgentMessage; readonly key: string; readonly isPending?: boolean }
  | { readonly kind: "tool-group"; readonly toolCalls: readonly ToolCall[]; readonly subAgentExecutions: readonly SubAgentExecution[]; readonly key: string }
  | { readonly kind: "sub-agent"; readonly subAgentExecution: SubAgentExecution; readonly key: string }
  | { readonly kind: "phase-badge"; readonly phase: ExecutionPhase; readonly key: string }
  | { readonly kind: "approval-request"; readonly pendingApproval: PendingApproval; readonly key: string }
  | { readonly kind: "setup-progress"; readonly workspaceEntries: readonly WorkspaceEntry[]; readonly serverPhase?: string; readonly isAwaitingResponse?: boolean; readonly key: string }
  | { readonly kind: "context-compacted"; readonly event: SummarizationEventView; readonly key: string };

function hasAiMessages(execution: AgentExecution): boolean {
  const messages = execution.status?.messages;
  if (!messages || messages.length === 0) return false;
  return messages.some(
    (m) =>
      m.type === MessageType.MESSAGE_AI && (m.content.trim() || m.toolCalls.length > 0),
  );
}

/**
 * Builds a flat list of renderable thread items from execution data.
 *
 * Keys use stable execution IDs (not array indices) so React can
 * reconcile items across renders without unnecessary remounts.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function buildThreadItems(
  executions: readonly AgentExecution[],
  activeStreamExecution: AgentExecution | null | undefined,
  pendingUserMessage: string | null | undefined,
  includeApprovals: boolean,
  workspaceEntries: readonly WorkspaceEntry[] | undefined,
  summarizationEvents?: readonly SummarizationEventView[],
): ThreadItem[] {
  const items: ThreadItem[] = [];
  const allExecutions = activeStreamExecution
    ? [...executions, activeStreamExecution]
    : executions;
  const activeStreamIndex = activeStreamExecution
    ? allExecutions.length - 1
    : -1;

  // Build a queue of summarization events to interleave by timestamp.
  // Events are consumed as messages pass their timestamp.
  const pendingEvents = summarizationEvents?.length
    ? [...summarizationEvents]
    : [];
  let eventCursor = 0;

  function flushEventsUntil(messageTimestamp: string | undefined): void {
    if (!messageTimestamp || pendingEvents.length === 0) return;
    while (
      eventCursor < pendingEvents.length &&
      pendingEvents[eventCursor].timestamp &&
      pendingEvents[eventCursor].timestamp <= messageTimestamp
    ) {
      const evt = pendingEvents[eventCursor];
      items.push({
        kind: "context-compacted",
        event: evt,
        key: `compacted-${evt.timestamp}`,
      });
      eventCursor++;
    }
  }

  for (let ei = 0; ei < allExecutions.length; ei++) {
    const exec = allExecutions[ei];
    const execId = exec.metadata?.id ?? `_e${ei}`;
    const isActiveStreamExec = ei === activeStreamIndex;
    const messages = exec.status?.messages ?? [];
    const subAgents = exec.status?.subAgentExecutions ?? [];

    const specMessage = exec.spec?.message;
    if (specMessage && specMessage !== "execute") {
      const syntheticHumanMsg = create(AgentMessageSchema);
      syntheticHumanMsg.type = MessageType.MESSAGE_HUMAN;
      syntheticHumanMsg.content = specMessage;

      // When the active stream execution's spec message matches the
      // pending user message, use a shared bridging key so React
      // updates the pending bubble in place instead of remounting.
      const bridgePending =
        isActiveStreamExec &&
        pendingUserMessage != null &&
        specMessage === pendingUserMessage;

      items.push({
        kind: "message",
        message: syntheticHumanMsg,
        key: bridgePending ? "pending-user-turn" : `${execId}-spec`,
      });
    }

    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];

      // MESSAGE_TOOL messages are not rendered — tool calls are attached
      // to their parent MESSAGE_AI and rendered via ToolCallGroup.
      if (msg.type === MessageType.MESSAGE_TOOL) continue;

      flushEventsUntil(msg.timestamp);

      const isEmptyAi =
        msg.type === MessageType.MESSAGE_AI && !msg.content.trim();

      if (!isEmptyAi) {
        items.push({
          kind: "message",
          message: msg,
          key: `${execId}-m${mi}`,
        });
      }

      if (
        msg.type === MessageType.MESSAGE_AI &&
        msg.toolCalls.length > 0
      ) {
        const hasTaskTools = msg.toolCalls.some((tc) => tc.name === "task");

        if (hasTaskTools) {
          const regularTools: ToolCall[] = [];
          const matchedSubAgents: SubAgentExecution[] = [];
          for (const tc of msg.toolCalls) {
            if (tc.name === "task") {
              const matched = subAgents.find((sa) => sa.id === tc.id);
              if (matched) matchedSubAgents.push(matched);
            } else {
              regularTools.push(tc);
            }
          }
          if (regularTools.length > 0) {
            items.push({
              kind: "tool-group",
              toolCalls: regularTools,
              subAgentExecutions: subAgents,
              key: `${execId}-m${mi}-tc`,
            });
          }
          for (const sa of matchedSubAgents) {
            items.push({
              kind: "sub-agent",
              subAgentExecution: sa,
              key: `sa-${sa.id}`,
            });
          }
        } else {
          items.push({
            kind: "tool-group",
            toolCalls: msg.toolCalls,
            subAgentExecutions: subAgents,
            key: `${execId}-m${mi}-tc`,
          });
        }
      }
    }
  }

  // Flush any remaining summarization events that occurred after all messages
  while (eventCursor < pendingEvents.length) {
    const evt = pendingEvents[eventCursor];
    items.push({
      kind: "context-compacted",
      event: evt,
      key: `compacted-${evt.timestamp}`,
    });
    eventCursor++;
  }

  const lastExec = allExecutions[allExecutions.length - 1];
  const lastPhase =
    lastExec?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  if (activeStreamExecution && !hasAiMessages(activeStreamExecution)) {
    const isPending =
      lastPhase === ExecutionPhase.EXECUTION_PENDING ||
      lastPhase === ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
    const isInProgressNoMessages =
      lastPhase === ExecutionPhase.EXECUTION_IN_PROGRESS;

    if (isPending) {
      const serverPhase =
        activeStreamExecution.status?.setupProgress?.currentPhase || undefined;
      items.push({
        kind: "setup-progress",
        workspaceEntries: workspaceEntries ?? [],
        serverPhase,
        key: "setup-progress",
      });
    } else if (isInProgressNoMessages) {
      items.push({
        kind: "setup-progress",
        workspaceEntries: workspaceEntries ?? [],
        isAwaitingResponse: true,
        key: "setup-progress",
      });
    }
  }

  if (
    isTerminalPhase(lastPhase) &&
    lastPhase !== ExecutionPhase.EXECUTION_COMPLETED
  ) {
    items.push({
      kind: "phase-badge",
      phase: lastPhase,
      key: `phase-${lastPhase}`,
    });
  }

  if (includeApprovals) {
    const allApprovals = lastExec?.status?.pendingApprovals ?? [];
    for (let ai = 0; ai < allApprovals.length; ai++) {
      const approval = allApprovals[ai];
      items.push({
        kind: "approval-request",
        pendingApproval: approval,
        key: `approval-${approval.toolCallId || ai}`,
      });
    }
  }

  if (pendingUserMessage) {
    const alreadySynthesized =
      lastExec?.spec?.message === pendingUserMessage;
    if (!alreadySynthesized) {
      const syntheticPending = create(AgentMessageSchema);
      syntheticPending.type = MessageType.MESSAGE_HUMAN;
      syntheticPending.content = pendingUserMessage;
      items.push({
        kind: "message",
        message: syntheticPending,
        key: "pending-user-turn",
        isPending: true,
      });
    }
  }

  return items;
}

/**
 * Renders a continuous conversation thread from one or more
 * {@link AgentExecution} snapshots.
 *
 * Composes {@link MessageEntry}, {@link ToolCallGroup}, and
 * {@link ExecutionPhaseBadge} into a scrollable, auto-scrolling log
 * that follows new content when the user is near the bottom.
 *
 * Renders nothing when no executions are provided.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const { executions } = useSessionExecutions(sessionId);
 * const stream = useExecutionStream(activeId);
 *
 * <MessageThread
 *   executions={executions ?? []}
 *   activeStreamExecution={stream.execution}
 * />
 * ```
 */
export function MessageThread({
  executions,
  activeStreamExecution,
  pendingUserMessage,
  className,
  formatToolCallSummary,
  onApprovalSubmit,
  submittingApprovalIds,
  workspaceEntries,
  onFilePathClick,
  sandboxWorkspaceRoot,
  summarizationEvents,
  virtualized = false,
}: MessageThreadProps) {
  useRenderTracer("MessageThread", { executions, activeStreamExecution });

  const includeApprovals = onApprovalSubmit != null;
  const items = useMemo(
    () => buildThreadItems(executions, activeStreamExecution, pendingUserMessage, includeApprovals, workspaceEntries, summarizationEvents),
    [executions, activeStreamExecution, pendingUserMessage, includeApprovals, workspaceEntries, summarizationEvents],
  );

  useKeyStability(items);

  const filePathCtx = useMemo<FilePathContextValue>(
    () => ({
      workspaceEntries: workspaceEntries ?? [],
      onFilePathClick,
    }),
    [workspaceEntries, onFilePathClick],
  );

  const sandboxCtx = useMemo<SandboxContextValue>(
    () => ({ sandboxWorkspaceRoot: sandboxWorkspaceRoot ?? "" }),
    [sandboxWorkspaceRoot],
  );

  if (virtualized) {
    return (
      <div className={cn("relative min-h-0", className)}>
        <Suspense fallback={null}>
          <LazyVirtualizedThread
            items={items}
            formatToolCallSummary={formatToolCallSummary}
            onApprovalSubmit={onApprovalSubmit}
            submittingApprovalIds={submittingApprovalIds}
            filePathCtx={filePathCtx}
            sandboxCtx={sandboxCtx}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <NonVirtualizedThread
      items={items}
      className={className}
      formatToolCallSummary={formatToolCallSummary}
      onApprovalSubmit={onApprovalSubmit}
      submittingApprovalIds={submittingApprovalIds}
      filePathCtx={filePathCtx}
      sandboxCtx={sandboxCtx}
    />
  );
}

// ---------------------------------------------------------------------------
// NonVirtualizedThread — original scroll-container rendering path
// ---------------------------------------------------------------------------

interface NonVirtualizedThreadProps {
  readonly items: readonly ThreadItem[];
  readonly className?: string;
  readonly formatToolCallSummary?: (toolCalls: readonly ToolCall[]) => string;
  readonly onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
  readonly submittingApprovalIds?: ReadonlySet<string>;
  readonly filePathCtx: FilePathContextValue;
  readonly sandboxCtx: SandboxContextValue;
}

function NonVirtualizedThread({
  items,
  className,
  formatToolCallSummary,
  onApprovalSubmit,
  submittingApprovalIds,
  filePathCtx,
  sandboxCtx,
}: NonVirtualizedThreadProps) {
  const { scrollRef, sentinelRef, contentRef, isFollowing, jumpToLatest } =
    useAutoScroll();

  useDomNodeCount(scrollRef, "MessageThread");

  return (
    <div className={cn("relative min-h-0", className)}>
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className={cn(
          "h-full overflow-y-auto pt-6 pb-4 [overflow-anchor:none]",
          "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
          "[&::-webkit-scrollbar]:w-1.5",
          "[&::-webkit-scrollbar-track]:bg-transparent",
          "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/40",
        )}
      >
        <SandboxContext.Provider value={sandboxCtx}>
        <FilePathContext.Provider value={filePathCtx}>
        <DevProfiler id="MessageThread">
          <div ref={contentRef} className="flex flex-col gap-4">
            {items.map((item) => (
              <ThreadItemWrapper key={item.key} animate>
                <ThreadItemRenderer
                  item={item}
                  formatToolCallSummary={formatToolCallSummary}
                  onApprovalSubmit={onApprovalSubmit}
                  submittingApprovalIds={submittingApprovalIds}
                />
              </ThreadItemWrapper>
            ))}
          </div>
        </DevProfiler>
        </FilePathContext.Provider>
        </SandboxContext.Provider>
        <div ref={sentinelRef} aria-hidden="true" />
      </div>
      <JumpToLatestButton onClick={jumpToLatest} visible={!isFollowing} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThreadItemRenderer — renders a single ThreadItem by kind
// ---------------------------------------------------------------------------

/**
 * Props for {@link ThreadItemRenderer}.
 *
 * @internal Exported for internal use by `VirtualizedThread` — not
 * part of the public API.
 */
export interface ThreadItemRendererProps {
  readonly item: ThreadItem;
  readonly formatToolCallSummary?: (toolCalls: readonly ToolCall[]) => string;
  readonly onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
  readonly submittingApprovalIds?: ReadonlySet<string>;
}

/**
 * Renders a single thread item by discriminated `kind`. Used by both
 * the non-virtualized `items.map()` path and the virtualized
 * `Virtuoso.itemContent` callback.
 *
 * Does not receive a `key` prop — the caller is responsible for
 * keying (either via `items.map` or `computeItemKey`).
 *
 * @internal Exported for internal use by `VirtualizedThread` — not
 * part of the public API.
 */
export function ThreadItemRenderer({
  item,
  formatToolCallSummary,
  onApprovalSubmit,
  submittingApprovalIds,
}: ThreadItemRendererProps) {
  switch (item.kind) {
    case "message":
      return (
        <MessageEntry
          message={item.message}
          className={item.isPending ? "opacity-70" : undefined}
        />
      );
    case "tool-group":
      return (
        <ToolCallGroup
          toolCalls={item.toolCalls}
          subAgentExecutions={item.subAgentExecutions}
          formatSummary={formatToolCallSummary}
          className="mx-4"
        />
      );
    case "sub-agent":
      return (
        <SubAgentSection
          subAgentExecution={item.subAgentExecution}
          className="mx-4"
        />
      );
    case "phase-badge":
      return (
        <div className="flex justify-center py-3">
          <ExecutionPhaseBadge phase={item.phase} />
        </div>
      );
    case "approval-request":
      return (
        <ApprovalCardRow
          pendingApproval={item.pendingApproval}
          onApprovalSubmit={onApprovalSubmit!}
          isSubmitting={submittingApprovalIds?.has(item.pendingApproval.toolCallId) ?? false}
        />
      );
    case "setup-progress":
      return (
        <SetupProgress
          workspaceEntries={item.workspaceEntries}
          serverPhase={item.serverPhase}
          isAwaitingResponse={item.isAwaitingResponse}
        />
      );
    case "context-compacted":
      return <SummarizationCard event={item.event} />;
  }
}

// ---------------------------------------------------------------------------
// ApprovalCardRow — stabilizes the onSubmit callback for React.memo
// ---------------------------------------------------------------------------

interface ApprovalCardRowProps {
  readonly pendingApproval: PendingApproval;
  readonly onApprovalSubmit: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
  readonly isSubmitting: boolean;
}

const ApprovalCardRow = memo(function ApprovalCardRow({
  pendingApproval,
  onApprovalSubmit,
  isSubmitting,
}: ApprovalCardRowProps) {
  const handleSubmit = useCallback(
    (action: ApprovalAction, comment?: string) => {
      onApprovalSubmit(pendingApproval.toolCallId, action, comment);
    },
    [onApprovalSubmit, pendingApproval.toolCallId],
  );

  return (
    <ApprovalCard
      pendingApproval={pendingApproval}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      className="mx-4"
    />
  );
});
