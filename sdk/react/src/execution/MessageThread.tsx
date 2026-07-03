"use client";

import { lazy, memo, Suspense, useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  FileChangeSetStatus,
  InteractionMode,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { displayFileChangeSets } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { isTerminalPhase } from "./execution-phases.js";
import { MessageEntry } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { SubAgentSection } from "./SubAgentSection.js";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge.js";
import { SetupProgress } from "./SetupProgress.js";
import { ApprovalCard } from "./ApprovalCard.js";
import { FileReviewCard } from "./FileReviewCard.js";
import { SummarizationCard } from "./SummarizationCard.js";
import { PlanCompletionCard } from "./PlanCompletionCard.js";
import { PlanArtifactCard } from "./PlanArtifactCard.js";
import { TodoCard } from "./TodoCard.js";
import { findPlanArtifact } from "../library/detect-plan-artifact.js";
import type { SummarizationEventView } from "./useContextWindow.js";
import { isInternalTool, isCollapsedToolCall } from "./tool-categories.js";
import { FilePathContext, type FilePathContextValue } from "./FilePathContext.js";
import type { ResolvedPathAction } from "./file-path-resolver.js";
import { SandboxContext, type SandboxContextValue } from "./SandboxContext.js";
import { ApprovalContext, type ApprovalContextValue } from "./ApprovalContext.js";
import { FileReviewContext, type FileReviewContextValue } from "./FileReviewContext.js";
import { useRenderTracer, useKeyStability, useDomNodeCount, DevProfiler } from "../internal/dev/index.js";
import { useAutoScroll } from "../internal/useAutoScroll.js";
import { JumpToLatestButton } from "../internal/JumpToLatestButton.js";
import { ApprovalPeekBar } from "../internal/ApprovalPeekBar.js";
import { ThreadItemWrapper } from "../internal/ThreadItemWrapper.js";

const LazyVirtualizedThread = lazy(() =>
  import("../internal/VirtualizedThread.js").then((m) => ({
    default: m.VirtualizedThread,
  })),
);

/** Stable empty collections so an approval-free thread keeps referential identity. */
const EMPTY_APPROVALS: readonly PendingApproval[] = [];
const EMPTY_SUBMITTING_IDS: ReadonlySet<string> = new Set();
const EMPTY_APPROVAL_ERRORS: ReadonlyMap<string, Error> = new Map();

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
  /**
   * Marks the pending user message as failed-to-send. The optimistic
   * bubble renders an inline "Couldn't send — Retry" affordance instead
   * of the sending indicator, so a failed follow-up never silently
   * vanishes. Pair with {@link onRetrySend}.
   *
   * @default false
   */
  readonly pendingMessageFailed?: boolean;
  /**
   * Retry handler for a failed pending message. Wired to the inline
   * "Retry" control when {@link pendingMessageFailed} is `true`.
   */
  readonly onRetrySend?: () => void;
  /**
   * When provided, the in-flight human turn (the active execution's prompt)
   * shows a hover "Edit" affordance. Clicking it invokes this callback with
   * the message text — the session chat stops the running execution and
   * pre-fills the composer for an edit-and-resubmit.
   *
   * Provide this only while the active execution is stoppable; the SDK marks
   * exactly the active-stream human turn editable. When omitted, no edit
   * control is shown (backward compatible).
   */
  readonly onEditMessage?: (text: string) => void;
  /**
   * Retry handler for a terminal-failed execution that exposed a server
   * error reason. Receives the originating message; the consumer typically
   * resends it as a new execution. When omitted, no Retry control is shown
   * beside the surfaced failure reason.
   */
  readonly onRetryExecution?: (message: string) => void;
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
   * Per-tool-call approval failures, keyed by `toolCallId` — surfaced in-card
   * beside the gate that failed (an inline tool row or the bottom backstop
   * card). Supply {@link useSubmitApproval}'s `errorsByToolCallId`. Only
   * meaningful when `onApprovalSubmit` is provided.
   */
  readonly approvalErrors?: ReadonlyMap<string, Error>;
  /**
   * Render each *settled* captured change set as a read-only record card at
   * its anchor in the thread (after the set's last stamped edit row) — the
   * durable history of what changed and how it was decided. This is the only
   * in-thread trace for a set with no stamped rows (e.g. changes made by shell
   * commands), so the surface that owns the session history should enable it.
   *
   * The thread never renders *decision* controls: a pending (AWAITING_REVIEW)
   * set on a live execution is deliberately NOT emitted here — its decision
   * surface is the composer-docked {@link FileReviewDock}, which cannot scroll
   * out of view. The stamped rows' badges carry the pending state in-thread.
   *
   * Opt-in with a backward-compatible default (DD-011); `SessionViewer`
   * enables it.
   *
   * @default false
   */
  readonly showFileReviewRecords?: boolean;
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
  /**
   * Called when the user clicks "Implement" on a completed Plan-mode
   * execution's {@link PlanCompletionCard}.
   *
   * When provided, a CTA card is rendered at the end of the thread
   * after a Plan-mode execution completes successfully. The consumer
   * typically wires this to switch the interaction mode to Agent,
   * pre-fill the composer, and focus it.
   *
   * When omitted, no plan completion card is rendered. Backward
   * compatible — existing consumers see no change.
   */
  readonly onBuildFromPlan?: () => void;
  /**
   * Organization slug. Required for the plan completion card's
   * "Review plan" action, which opens the shared artifact preview
   * modal (the modal needs `org` for its detection/apply pipeline).
   */
  readonly org?: string;
  /**
   * Disables the plan completion card's actions (Implement / Review).
   * Defense in depth for the brief windows where a follow-up cannot be
   * sent (e.g. an execution is streaming); the composer also no-ops a
   * disabled submit.
   */
  readonly planActionsDisabled?: boolean;
  /**
   * Center thread content within a max-width reading column.
   *
   * When `true`, items are constrained to `max-w-3xl` (768 px) and
   * horizontally centered. The scroll container stays full-width so
   * the scrollbar remains at the viewport edge.
   *
   * Opt-in per DD-011 — existing consumers see no layout change.
   *
   * @default false
   */
  readonly centerContent?: boolean;
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
  | { readonly kind: "message"; readonly message: AgentMessage; readonly key: string; readonly isPending?: boolean; readonly isFailed?: boolean; readonly isEditable?: boolean }
  | { readonly kind: "tool-group"; readonly toolCalls: readonly ToolCall[]; readonly subAgentExecutions: readonly SubAgentExecution[]; readonly key: string }
  | { readonly kind: "sub-agent"; readonly subAgentExecution: SubAgentExecution; readonly key: string }
  | { readonly kind: "phase-badge"; readonly phase: ExecutionPhase; readonly key: string }
  | { readonly kind: "execution-error"; readonly error: string; readonly retryMessage?: string; readonly key: string }
  | { readonly kind: "approval-request"; readonly pendingApproval: PendingApproval; readonly key: string }
  | { readonly kind: "file-review-record"; readonly fileChangeSet: FileChangeSet; readonly key: string }
  | { readonly kind: "setup-progress"; readonly workspaceEntries: readonly WorkspaceEntry[]; readonly serverPhase?: string; readonly isAwaitingResponse?: boolean; readonly key: string }
  | { readonly kind: "context-compacted"; readonly event: SummarizationEventView; readonly key: string }
  | {
      readonly kind: "todos";
      readonly key: string;
      readonly executionId: string;
      readonly todos: { readonly [id: string]: TodoItem };
    }
  | {
      readonly kind: "plan-completion";
      readonly key: string;
      readonly executionId: string;
      readonly planArtifact?: ExecutionArtifact;
    };

/**
 * True once the agent has produced any real, renderable response for this turn —
 * assistant text, a tool call (running or terminal), or streamed model thinking.
 *
 * Gates the synthetic "Thinking…" setup placeholder (see usage below): the
 * placeholder is only for the genuine pre-first-content window and must yield the
 * moment any of these stream in, otherwise it would render *alongside* the real
 * ThinkingMessage / ToolCallGroup cards (the GitHub #179 duplicate-spinner).
 */
function hasStartedResponding(execution: AgentExecution): boolean {
  const messages = execution.status?.messages;
  if (!messages || messages.length === 0) return false;
  return messages.some((m) => {
    // Any tool call — RUNNING or terminal — is visible activity, regardless of
    // which message type hosts it.
    if (m.toolCalls.length > 0) return true;
    if (m.type === MessageType.MESSAGE_AI && m.content.trim().length > 0) return true;
    // Streamed reasoning renders in its own collapsible ThinkingMessage card, so
    // it counts as "responding" even before the first assistant token arrives.
    if (m.type === MessageType.MESSAGE_THINKING && m.content.trim().length > 0) return true;
    return false;
  });
}

/**
 * Adds the tool-call ids that a sub-agent renders as nested rows (the same
 * non-internal AI tool calls {@link SubAgentSection} surfaces) to `target`,
 * so their approvals are treated as inline and skip the bottom backstop.
 */
function collectSubAgentInlineToolCallIds(
  sub: SubAgentExecution,
  target: Set<string>,
): void {
  for (const msg of sub.messages) {
    if (msg.type !== MessageType.MESSAGE_AI) continue;
    for (const tc of msg.toolCalls) {
      if (tc.id && !isInternalTool(tc.name)) target.add(tc.id);
    }
  }
}

/**
 * Records, for each change set referenced by a just-pushed tool-group item, the
 * item's index — later groups overwrite, so the map converges on each set's
 * LAST stamped row. That index is where the set's decision bar anchors: the
 * review surface appears where the turn's editing activity ended, not at the
 * thread tail.
 */
function recordFileReviewAnchors(
  toolCalls: readonly ToolCall[],
  itemIndex: number,
  anchorIndexBySetId: Map<string, number>,
): void {
  for (const tc of toolCalls) {
    if (tc.fileChangeSetId) anchorIndexBySetId.set(tc.fileChangeSetId, itemIndex);
  }
}

/**
 * Inserts one execution's settled file-review records into its own thread
 * segment: each change set's read-only `file-review-record` item is spliced
 * immediately after the set's last stamped tool row
 * ({@link recordFileReviewAnchors}); a set with no stamped row (its changes
 * were made by shell commands, or the rows predate stamping) falls back to the
 * segment's tail — this record is that set's ONLY in-thread trace, so it is
 * never dropped.
 *
 * A *pending* set — AWAITING_REVIEW on a live (non-terminal) execution — is
 * deliberately NOT emitted: its decision surface is the composer-docked
 * `FileReviewDock`, which cannot scroll out of view, and the stamped rows'
 * badges carry the pending state in place. The same set re-enters here as a
 * record the moment it settles (or its execution terminates mid-review — an
 * honest "not reviewed" record). A CAPTURING set (baseline only, no diff yet)
 * has nothing to show and is skipped.
 */
function insertFileReviewItems(
  items: ThreadItem[],
  changeSets: readonly FileChangeSet[],
  anchorIndexBySetId: ReadonlyMap<string, number>,
  execTerminal: boolean,
): void {
  const anchored: { index: number; item: ThreadItem }[] = [];
  const tail: ThreadItem[] = [];
  for (const changeSet of changeSets) {
    if (changeSet.changes.length === 0) continue;
    const pending =
      !execTerminal && changeSet.status === FileChangeSetStatus.AWAITING_REVIEW;
    if (pending) continue;
    const item: ThreadItem = {
      kind: "file-review-record",
      fileChangeSet: changeSet,
      key: `file-review-${changeSet.id}`,
    };
    const index = anchorIndexBySetId.get(changeSet.id);
    if (index !== undefined) anchored.push({ index, item });
    else tail.push(item);
  }
  // Splice in ascending anchor order with a running offset so earlier inserts
  // do not displace later anchors.
  anchored.sort((a, b) => a.index - b.index);
  let offset = 0;
  for (const { index, item } of anchored) {
    items.splice(index + 1 + offset, 0, item);
    offset++;
  }
  items.push(...tail);
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
  pendingMessageFailed = false,
  editableActiveTurn = false,
  includeFileReviewRecords = false,
): ThreadItem[] {
  const items: ThreadItem[] = [];
  // Tool-call ids that render as an inline-approval-capable ToolCallItem (a
  // regular parent tool, or a sub-agent's nested tool). Their approvals show
  // inline on the row, so they are excluded from the bottom backstop below —
  // a task-spawn call (rendered as a SubAgentSection, not a tool row) is NOT
  // collected, so its spawn-gate approval still surfaces at the bottom.
  const inlineToolCallIds = new Set<string>();
  // Dedupe by execution id, with activeStreamExecution authoritative for its own
  // id. The hook passes `completedExecutions` (filtered on activeExecutionId),
  // but that filter and activeStreamExecution (stream.execution ??
  // fetchedActiveExecution) derive from different sources, so a transient skew
  // can leave the active execution in BOTH lists. Concatenating blindly then
  // emits the same execution twice → duplicate React keys → React silently drops
  // one subtree, intermittently the one carrying a live ApprovalCard (the gate
  // buttons vanish). Dropping any prior entry sharing the active id keeps the
  // streamed copy as the single source of truth and the append-at-end invariant
  // (activeStreamIndex === last) intact.
  const allExecutions = activeStreamExecution
    ? [
        ...executions.filter(
          (e) => e.metadata?.id !== activeStreamExecution.metadata?.id,
        ),
        activeStreamExecution,
      ]
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

    // This execution's settled change sets render as read-only records inside
    // its own segment, anchored to the last stamped edit row of each set. The
    // display seam reads the server's live projection when present and folds
    // the durable ledger for a terminal execution (whose projection is nil),
    // so records surface for EVERY execution, not just the last. Pending sets
    // are excluded inside insertFileReviewItems — the composer dock owns them.
    const execChangeSets = includeFileReviewRecords
      ? displayFileChangeSets(exec.status)
      : [];
    const fileReviewAnchors = new Map<string, number>();

    // The agent's plan renders as one inline card per turn, anchored to the
    // first of: the opening AI/thinking message, the first unit of work
    // (tool-group / sub-agent), or — as a backstop — the turn's tail. We carry
    // the live `status.todos` reference (structural sharing keeps it stable),
    // so the card updates in place and a settled card skips re-renders.
    const execTodos = exec.status?.todos;
    const hasTodos = execTodos != null && Object.keys(execTodos).length > 0;
    let todosEmitted = false;
    function emitTodos(): void {
      if (todosEmitted || !hasTodos) return;
      todosEmitted = true;
      items.push({
        kind: "todos",
        executionId: execId,
        todos: execTodos!,
        key: `${execId}-todos`,
      });
    }

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
        // The active execution's prompt is the one a user can edit-and-resubmit
        // (stop + rephrase). Only mark it when the consumer enabled editing.
        isEditable: isActiveStreamExec && editableActiveTurn,
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
        // Anchor (1): the plan sits right under the agent's opening narration.
        if (
          msg.type === MessageType.MESSAGE_AI ||
          msg.type === MessageType.MESSAGE_THINKING
        ) {
          emitTodos();
        }
      }

      // Runner-collapsed duplicates (a superseded same-turn denial twin of an
      // approval gate) are not rendered — they are kept in the transcript only to
      // satisfy the backend's append-only guard. Filtering them here keeps a
      // message whose tool calls are ALL collapsed from emitting an empty group.
      // Preserve the original array reference when nothing is collapsed (the
      // common case) so structural sharing / memoization (T04) is not defeated by
      // a fresh array on every build.
      const renderableToolCalls =
        msg.type === MessageType.MESSAGE_AI && msg.toolCalls.some(isCollapsedToolCall)
          ? msg.toolCalls.filter((tc) => !isCollapsedToolCall(tc))
          : msg.toolCalls;

      if (
        msg.type === MessageType.MESSAGE_AI &&
        renderableToolCalls.length > 0
      ) {
        // Anchor (2): if work begins before any rendered narration, the plan
        // still leads it.
        emitTodos();

        const needsSplit = renderableToolCalls.some(
          (tc) => tc.name === "task" || isInternalTool(tc.name),
        );

        if (needsSplit) {
          const regularTools: ToolCall[] = [];
          const matchedSubAgents: SubAgentExecution[] = [];
          for (const tc of renderableToolCalls) {
            if (tc.name === "task") {
              const matched = subAgents.find((sa) => sa.id === tc.id);
              if (matched) matchedSubAgents.push(matched);
            } else if (!isInternalTool(tc.name)) {
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
            recordFileReviewAnchors(regularTools, items.length - 1, fileReviewAnchors);
            for (const tc of regularTools) {
              if (tc.id) inlineToolCallIds.add(tc.id);
            }
          }
          for (const sa of matchedSubAgents) {
            items.push({
              kind: "sub-agent",
              subAgentExecution: sa,
              key: `sa-${sa.id}`,
            });
            collectSubAgentInlineToolCallIds(sa, inlineToolCallIds);
          }
        } else {
          items.push({
            kind: "tool-group",
            toolCalls: renderableToolCalls,
            subAgentExecutions: subAgents,
            key: `${execId}-m${mi}-tc`,
          });
          recordFileReviewAnchors(renderableToolCalls, items.length - 1, fileReviewAnchors);
          for (const tc of renderableToolCalls) {
            if (tc.id) inlineToolCallIds.add(tc.id);
          }
        }
      }
    }

    // Anchor (3): a plan that produced no rendered narration or work item still
    // surfaces — never silently dropped.
    emitTodos();

    // Settled records land inside this execution's segment, at their anchors.
    if (execChangeSets.length > 0) {
      insertFileReviewItems(
        items,
        execChangeSets,
        fileReviewAnchors,
        isTerminalPhase(exec.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED),
      );
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

  if (activeStreamExecution && !hasStartedResponding(activeStreamExecution)) {
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

    // The server populates `status.error` only on EXECUTION_FAILED. Surface it
    // beside the badge so a failure that produced no messages still explains
    // itself (the CLI shows this reason; the chat previously showed nothing).
    // Kept as its own item so the badge component stays presentational.
    const reason = lastExec?.status?.error;
    if (reason) {
      const specMessage = lastExec?.spec?.message;
      items.push({
        kind: "execution-error",
        error: reason,
        retryMessage:
          specMessage && specMessage !== "execute" ? specMessage : undefined,
        key: `execution-error-${lastExec?.metadata?.id ?? lastPhase}`,
      });
    }
  }

  if (
    lastPhase === ExecutionPhase.EXECUTION_COMPLETED &&
    lastExec?.spec?.executionConfig?.interactionMode === InteractionMode.PLAN
  ) {
    items.push({
      kind: "plan-completion",
      key: "plan-completion",
      executionId: lastExec?.metadata?.id ?? "",
      planArtifact: findPlanArtifact(lastExec),
    });
  }

  if (includeApprovals) {
    // Backstop only: an approval whose tool call renders inline shows its gate
    // on that row (see ApprovalContext / ToolCallItem). We emit a bottom card
    // ONLY for an approval with no inline home — a true orphan, or a task-spawn
    // approval that precedes its SubAgentExecution — so a pending gate is never
    // invisible, and never duplicated.
    const allApprovals = lastExec?.status?.pendingApprovals ?? [];
    for (let ai = 0; ai < allApprovals.length; ai++) {
      const approval = allApprovals[ai];
      if (approval.toolCallId && inlineToolCallIds.has(approval.toolCallId)) {
        continue;
      }
      items.push({
        kind: "approval-request",
        pendingApproval: approval,
        key: `approval-${approval.toolCallId || ai}`,
      });
    }
  }

  // File-review records are emitted inside each execution's segment (see
  // insertFileReviewItems in the loop above) — anchored to the last stamped
  // edit row, never appended at the thread tail. Pending decision bars are
  // not thread items at all: they live in the composer-docked FileReviewDock.

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
        // A failed turn shows the inline error instead of the dimmed
        // sending state — the two are mutually exclusive.
        isPending: !pendingMessageFailed,
        isFailed: pendingMessageFailed,
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
  pendingMessageFailed = false,
  onRetrySend,
  onRetryExecution,
  onEditMessage,
  className,
  formatToolCallSummary,
  onApprovalSubmit,
  submittingApprovalIds,
  approvalErrors,
  showFileReviewRecords = false,
  workspaceEntries,
  onFilePathClick,
  sandboxWorkspaceRoot,
  summarizationEvents,
  virtualized = false,
  onBuildFromPlan,
  org,
  planActionsDisabled,
  centerContent = false,
}: MessageThreadProps) {
  useRenderTracer("MessageThread", { executions, activeStreamExecution });

  const includeApprovals = onApprovalSubmit != null;
  const editableActiveTurn = onEditMessage != null;
  const items = useMemo(
    () => buildThreadItems(executions, activeStreamExecution, pendingUserMessage, includeApprovals, workspaceEntries, summarizationEvents, pendingMessageFailed, editableActiveTurn, showFileReviewRecords),
    [executions, activeStreamExecution, pendingUserMessage, includeApprovals, workspaceEntries, summarizationEvents, pendingMessageFailed, editableActiveTurn, showFileReviewRecords],
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

  // Pending approvals live on the latest execution. We project them into a
  // tool-call-id-keyed map so each gated tool row can render its own approval
  // inline (see ApprovalContext); buildThreadItems still emits a bottom card
  // for any approval with no matching inline row (orphan backstop).
  const lastExec = activeStreamExecution ?? executions[executions.length - 1];
  const pendingApprovals = includeApprovals
    ? lastExec?.status?.pendingApprovals ?? EMPTY_APPROVALS
    : EMPTY_APPROVALS;

  const approvalsByToolCallId = useMemo(() => {
    const map = new Map<string, PendingApproval>();
    for (const approval of pendingApprovals) {
      if (approval.toolCallId) map.set(approval.toolCallId, approval);
    }
    return map;
  }, [pendingApprovals]);

  const approvalCtx = useMemo<ApprovalContextValue>(
    () => ({
      approvalsByToolCallId,
      onSubmit: onApprovalSubmit,
      submittingIds: submittingApprovalIds ?? EMPTY_SUBMITTING_IDS,
      errorsByToolCallId: approvalErrors ?? EMPTY_APPROVAL_ERRORS,
    }),
    [approvalsByToolCallId, onApprovalSubmit, submittingApprovalIds, approvalErrors],
  );

  // Every displayable change set across the session, keyed by id, so a stamped
  // edit row (ToolCall.file_change_set_id) can badge its set's live review
  // state wherever it renders (parent thread or nested groups). The map is
  // rebuilt only when the execution list reference changes; structural sharing
  // keeps each FileChangeSet reference stable across streaming frames, so
  // subscribing rows re-render on review events, not every snapshot.
  const fileReviewCtx = useMemo<FileReviewContextValue>(() => {
    const map = new Map<string, FileChangeSet>();
    const all = activeStreamExecution
      ? [...executions, activeStreamExecution]
      : executions;
    for (const exec of all) {
      for (const changeSet of displayFileChangeSets(exec.status)) {
        // Later wins: the active stream's copy supersedes a stale fetched one.
        map.set(changeSet.id, changeSet);
      }
    }
    return { changeSetsById: map };
  }, [executions, activeStreamExecution]);

  // Drives the global "approval needed" peek affordance — a count, not the
  // cards, so the bar reuses the existing scroll machine without a new observer.
  const unresolvedApprovalCount = pendingApprovals.length;

  if (virtualized) {
    return (
      <div className={cn("relative min-h-0", className)}>
        <Suspense fallback={null}>
          <LazyVirtualizedThread
            items={items}
            formatToolCallSummary={formatToolCallSummary}
            onApprovalSubmit={onApprovalSubmit}
            submittingApprovalIds={submittingApprovalIds}
            approvalErrors={approvalErrors}
            filePathCtx={filePathCtx}
            sandboxCtx={sandboxCtx}
            approvalCtx={approvalCtx}
            fileReviewCtx={fileReviewCtx}
            unresolvedApprovalCount={unresolvedApprovalCount}
            onBuildFromPlan={onBuildFromPlan}
            org={org}
            planActionsDisabled={planActionsDisabled}
            centerContent={centerContent}
            onRetrySend={onRetrySend}
            onRetryExecution={onRetryExecution}
            onEditMessage={onEditMessage}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <NonVirtualizedThread
      items={items}
      className={className}
      centerContent={centerContent}
      formatToolCallSummary={formatToolCallSummary}
      onApprovalSubmit={onApprovalSubmit}
      submittingApprovalIds={submittingApprovalIds}
      approvalErrors={approvalErrors}
      filePathCtx={filePathCtx}
      sandboxCtx={sandboxCtx}
      approvalCtx={approvalCtx}
      fileReviewCtx={fileReviewCtx}
      unresolvedApprovalCount={unresolvedApprovalCount}
      onBuildFromPlan={onBuildFromPlan}
      org={org}
      planActionsDisabled={planActionsDisabled}
      onRetrySend={onRetrySend}
      onRetryExecution={onRetryExecution}
      onEditMessage={onEditMessage}
    />
  );
}

// ---------------------------------------------------------------------------
// NonVirtualizedThread — original scroll-container rendering path
// ---------------------------------------------------------------------------

interface NonVirtualizedThreadProps {
  readonly items: readonly ThreadItem[];
  readonly className?: string;
  readonly centerContent?: boolean;
  readonly formatToolCallSummary?: (toolCalls: readonly ToolCall[]) => string;
  readonly onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
  readonly submittingApprovalIds?: ReadonlySet<string>;
  readonly approvalErrors?: ReadonlyMap<string, Error>;
  readonly filePathCtx: FilePathContextValue;
  readonly sandboxCtx: SandboxContextValue;
  readonly approvalCtx: ApprovalContextValue;
  readonly fileReviewCtx: FileReviewContextValue;
  readonly unresolvedApprovalCount: number;
  readonly onBuildFromPlan?: () => void;
  readonly org?: string;
  readonly planActionsDisabled?: boolean;
  readonly onRetrySend?: () => void;
  readonly onRetryExecution?: (message: string) => void;
  readonly onEditMessage?: (text: string) => void;
}

function NonVirtualizedThread({
  items,
  className,
  centerContent,
  formatToolCallSummary,
  onApprovalSubmit,
  submittingApprovalIds,
  approvalErrors,
  filePathCtx,
  sandboxCtx,
  approvalCtx,
  fileReviewCtx,
  unresolvedApprovalCount,
  onBuildFromPlan,
  org,
  planActionsDisabled,
  onRetrySend,
  onRetryExecution,
  onEditMessage,
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
        <ApprovalContext.Provider value={approvalCtx}>
        <FileReviewContext.Provider value={fileReviewCtx}>
        <DevProfiler id="MessageThread">
          <div ref={contentRef} className={cn("flex flex-col gap-4", centerContent && "mx-auto w-full max-w-3xl px-4")}>
            {items.map((item) => (
              <ThreadItemWrapper key={item.key} animate>
                <ThreadItemRenderer
                  item={item}
                  formatToolCallSummary={formatToolCallSummary}
                  onApprovalSubmit={onApprovalSubmit}
                  submittingApprovalIds={submittingApprovalIds}
                  approvalErrors={approvalErrors}
                  onBuildFromPlan={onBuildFromPlan}
                  org={org}
                  planActionsDisabled={planActionsDisabled}
                  onRetrySend={onRetrySend}
                  onRetryExecution={onRetryExecution}
                  onEditMessage={onEditMessage}
                />
              </ThreadItemWrapper>
            ))}
          </div>
        </DevProfiler>
        </FileReviewContext.Provider>
        </ApprovalContext.Provider>
        </FilePathContext.Provider>
        </SandboxContext.Provider>
        <div ref={sentinelRef} aria-hidden="true" />
      </div>
      {/* The peek bar takes the jump button's slot while approvals are pending,
          so the two never overlap — a gate is the louder of the two signals. */}
      <JumpToLatestButton
        onClick={jumpToLatest}
        visible={!isFollowing && unresolvedApprovalCount === 0}
      />
      <ApprovalPeekBar
        visible={!isFollowing && unresolvedApprovalCount > 0}
        count={unresolvedApprovalCount}
        onClick={jumpToLatest}
      />
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
  readonly approvalErrors?: ReadonlyMap<string, Error>;
  readonly onBuildFromPlan?: () => void;
  readonly org?: string;
  readonly planActionsDisabled?: boolean;
  readonly onRetrySend?: () => void;
  readonly onRetryExecution?: (message: string) => void;
  readonly onEditMessage?: (text: string) => void;
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
  approvalErrors,
  onBuildFromPlan,
  org,
  planActionsDisabled,
  onRetrySend,
  onRetryExecution,
  onEditMessage,
}: ThreadItemRendererProps) {
  switch (item.kind) {
    case "message":
      if (item.isFailed) {
        return (
          <FailedUserMessage message={item.message} onRetry={onRetrySend} />
        );
      }
      return (
        <MessageEntry
          message={item.message}
          className={item.isPending ? "opacity-70" : undefined}
          onEdit={
            item.isEditable && onEditMessage
              ? () => onEditMessage(item.message.content)
              : undefined
          }
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
    case "execution-error":
      return (
        <ExecutionErrorNotice
          error={item.error}
          retryMessage={item.retryMessage}
          onRetry={onRetryExecution}
        />
      );
    case "approval-request":
      return (
        <ApprovalCardRow
          pendingApproval={item.pendingApproval}
          onApprovalSubmit={onApprovalSubmit!}
          isSubmitting={submittingApprovalIds?.has(item.pendingApproval.toolCallId) ?? false}
          error={approvalErrors?.get(item.pendingApproval.toolCallId) ?? null}
        />
      );
    case "file-review-record":
      return <FileReviewRecordRow fileChangeSet={item.fileChangeSet} />;
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
    case "todos":
      return <TodoCard todos={item.todos} className="mx-4" />;
    case "plan-completion":
      // When the plan was published as an artifact, show the richer reviewable
      // card (preview / copy / download / implement). Otherwise fall back to the
      // bare Implement CTA (older executions, or a plan that failed to publish).
      return item.planArtifact && item.executionId ? (
        <PlanArtifactCard
          executionId={item.executionId}
          artifact={item.planArtifact}
          org={org}
          onImplement={onBuildFromPlan}
          disabled={planActionsDisabled}
        />
      ) : (
        <PlanCompletionCard
          onImplement={onBuildFromPlan}
          disabled={planActionsDisabled}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// FailedUserMessage — optimistic turn whose send failed
// ---------------------------------------------------------------------------

/**
 * Renders a user message whose send failed: the message itself stays visible
 * (so the typed text is never lost) with an inline, actionable error beneath
 * it. The error copy is intentionally short — the full reason is surfaced by
 * the consumer's send-error banner; this is the in-thread "Retry" affordance.
 */
function FailedUserMessage({
  message,
  onRetry,
}: {
  message: AgentMessage;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <MessageEntry message={message} />
      <div
        role="alert"
        className="mx-4 flex items-center gap-2 text-xs text-destructive"
      >
        <span className="min-w-0 flex-1 truncate">Couldn&rsquo;t send.</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExecutionErrorNotice — server failure reason for a terminal-failed execution
// ---------------------------------------------------------------------------

/**
 * Recognizes a recoverable *interruption* (worker reaped / heartbeat timeout /
 * stall) as opposed to a genuine application failure. The runner stamps these
 * with a stable signature ("[StallTimeoutError]", "Execution interrupted",
 * "Retry or resume."), and the workflow auto-resumes them while recovery cycles
 * remain; by the time one reaches the UI as terminal it is resumable from the
 * session's persisted harness_state_id rather than a dead end.
 */
function isInterruptedError(error: string): boolean {
  return /\[StallTimeoutError\]|execution interrupted|retry or resume/i.test(error);
}

/**
 * Renders the server-reported failure reason (`AgentExecutionStatus.error`)
 * for an execution that died — typically before producing any messages. The
 * reason can be a long Temporal error, so it is clamped by default with a
 * Show more / Show less toggle.
 *
 * A genuine failure renders as a destructive alert with a Retry. A *recoverable
 * interruption* renders as a neutral notice with a Resume — both resend the
 * originating message, which the server continues from the session's persisted
 * harness_state_id (the same data path; the framing differs so an interruption
 * never looks like a dead-end crash).
 */
function ExecutionErrorNotice({
  error,
  retryMessage,
  onRetry,
}: {
  error: string;
  retryMessage?: string;
  onRetry?: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canRetry = !!onRetry && !!retryMessage;
  const interrupted = isInterruptedError(error);

  return (
    <div
      role={interrupted ? "status" : "alert"}
      className={cn(
        "mx-4 flex flex-col gap-1.5 rounded-md px-3 py-2",
        interrupted ? "bg-muted" : "bg-destructive-subtle",
      )}
    >
      <p
        className={cn(
          "text-xs whitespace-pre-wrap break-words",
          interrupted ? "text-foreground" : "text-destructive",
          !expanded && "line-clamp-3",
        )}
      >
        {error}
      </p>
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="font-medium text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
        {canRetry && (
          <button
            type="button"
            onClick={() => onRetry!(retryMessage!)}
            className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {interrupted ? "Resume" : "Retry"}
          </button>
        )}
      </div>
    </div>
  );
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
  // This gate's last failed decision, or null — a stable ref from the
  // approvalErrors map, so the row re-renders only when its error appears/clears.
  readonly error?: Error | null;
}

const ApprovalCardRow = memo(function ApprovalCardRow({
  pendingApproval,
  onApprovalSubmit,
  isSubmitting,
  error = null,
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
      error={error}
      className="mx-4"
    />
  );
});

// ---------------------------------------------------------------------------
// FileReviewRecordRow — a settled change set's read-only in-thread record
// ---------------------------------------------------------------------------

/**
 * Renders a settled change set as a read-only record at its position in the
 * transcript — what changed and how it was decided ("2 kept · 1 discarded").
 * Never interactive: the pending decision surface is the composer-docked
 * `FileReviewDock`, not a thread item (see {@link insertFileReviewItems}).
 */
const FileReviewRecordRow = memo(function FileReviewRecordRow({
  fileChangeSet,
}: {
  readonly fileChangeSet: FileChangeSet;
}) {
  return (
    <FileReviewCard
      fileChangeSet={fileChangeSet}
      interactive={false}
      // The thread's stamped edit rows already show every diff in place, so
      // the record renders its compact file-list body — the history never
      // duplicates the transcript's diffs.
      showDiffs={false}
      className="mx-4"
    />
  );
});
