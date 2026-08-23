"use client";

import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution, RecalledMemoriesReport } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { RecalledMemoryFact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
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
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { displayFileChangeSets, syntheticUserPrompt } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { isTerminalPhase } from "./execution-phases.js";
import { MessageEntry, type MessageEntryProps } from "./MessageEntry.js";
import type { MessageAttachmentView } from "./MessageAttachments.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { SubAgentSection } from "./SubAgentSection.js";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge.js";
import { SetupProgress, type SetupProgressProps } from "./SetupProgress.js";
import { RecalledMemoriesCard, type RecalledMemoriesCardProps } from "./RecalledMemoriesCard.js";
import {
  LivenessStatusLine,
  type LivenessStatusLineProps,
} from "./LivenessStatusLine.js";
import { ApprovalCard, type ApprovalCardProps } from "./ApprovalCard.js";
import { ExecutionErrorNotice, type ExecutionErrorNoticeProps } from "./ExecutionErrorNotice.js";
import { FileReviewCard } from "./FileReviewCard.js";
import { SummarizationCard } from "./SummarizationCard.js";
import { PlanCompletionCard, type PlanCompletionCardProps } from "./PlanCompletionCard.js";
import { PlanArtifactCard, type PlanArtifactCardProps } from "./PlanArtifactCard.js";
import { PlanStreamingCard, type PlanStreamingCardProps } from "./PlanStreamingCard.js";
import { TodoCard, type TodoCardProps } from "./TodoCard.js";
import type { TodoRowProps } from "./TodoList.js";
import { findPlanArtifact } from "../library/detect-plan-artifact.js";
import { findStreamingPlan } from "../library/detect-streaming-plan.js";
import type { SummarizationEventView } from "./useContextWindow.js";
import { isInternalTool, isCollapsedToolCall } from "./tool-categories.js";
import { FilePathContext, type FilePathContextValue } from "./FilePathContext.js";
import type { ResolvedPathAction } from "./file-path-resolver.js";
import { SandboxContext, type SandboxContextValue } from "./SandboxContext.js";
import { ApprovalContext, type ApprovalContextValue } from "./ApprovalContext.js";
import { FileReviewContext, type FileReviewContextValue } from "./FileReviewContext.js";
import {
  extractLeadingH1,
  unwrapEnclosingMarkdownFence,
} from "../internal/markdown-components.js";
import { useRenderTracer, useKeyStability, useDomNodeCount, DevProfiler } from "../internal/dev/index.js";
import { useAutoScroll, usePinToLatestOnSignal } from "../internal/useAutoScroll.js";
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

/**
 * Component overrides for the chrome {@link MessageThread} renders — the
 * adaptation surface for hosts whose design system needs different
 * *structure*, not just different `--stgm-*` token values (stigmer#187).
 *
 * Each slot is keyed by the built-in component it replaces and receives
 * exactly that component's exported props interface, so an override can
 * always delegate to the built-in for the cases it does not customize
 * (e.g. a `MessageEntry` slot that restyles `MESSAGE_HUMAN` bubbles and
 * renders the default `MessageEntry` for everything else).
 *
 * Define slot components at module level (or memoize them). The thread's
 * rows rely on `React.memo` + structural sharing to skip re-renders during
 * streaming (DD-009/DD-010); a slot component recreated on every host
 * render defeats that for its rows.
 */
export interface MessageThreadSlots {
  /**
   * All message bubbles — human, assistant, thinking, and system entries.
   * Also wraps the failed-send bubble (the inline Retry chrome around it
   * stays built-in).
   */
  readonly MessageEntry?: ComponentType<MessageEntryProps>;
  /** The HITL tool-approval gate card. */
  readonly ApprovalCard?: ComponentType<ApprovalCardProps>;
  /** The collapsible in-thread to-dos card. */
  readonly TodoCard?: ComponentType<TodoCardProps>;
  /**
   * One to-do row inside the built-in {@link TodoCard}'s list. Ignored
   * when `TodoCard` is also overridden (the replacement receives it via
   * {@link TodoCardProps.TodoRow} and may forward or ignore it).
   */
  readonly TodoRow?: ComponentType<TodoRowProps>;
  /** Completed Plan turn that published a plan artifact. */
  readonly PlanArtifactCard?: ComponentType<PlanArtifactCardProps>;
  /** Completed Plan turn without an artifact — the bare Implement CTA. */
  readonly PlanCompletionCard?: ComponentType<PlanCompletionCardProps>;
  /** Live stand-in card while a Plan turn is writing its document. */
  readonly PlanStreamingCard?: ComponentType<PlanStreamingCardProps>;
  /** Pre-first-token setup / "Thinking…" indicator. */
  readonly SetupProgress?: ComponentType<SetupProgressProps>;
  /**
   * The retriever transparency card at a selection-active execution's
   * segment start — "Recalled N of M memories" (DD-008 D5).
   */
  readonly RecalledMemoriesCard?: ComponentType<RecalledMemoriesCardProps>;
  /**
   * The terminal execution-failure notice. Receives the raw server-reported
   * reason and the retry wiring, so a host can turn the failure into its own
   * recovery moment (classify the reason, offer an alternate engine, link
   * support) instead of the built-in Show more / Retry treatment.
   */
  readonly ExecutionErrorNotice?: ComponentType<ExecutionErrorNoticeProps>;
  /**
   * The ambient-liveness status line at the thread's tail while the active
   * execution is live between visible events (stigmer#277). Override to
   * supply a host-voiced label or richer treatment; the emission policy
   * (when the line appears at all) stays with the thread.
   */
  readonly LivenessStatusLine?: ComponentType<LivenessStatusLineProps>;
}

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
   * Attachments submitted with the pending user message, rendered as chips
   * on the optimistic bubble so the files never vanish between submit and
   * the stream's first snapshot (stigmer/stigmer#372). Supply
   * {@link useSessionConversation}'s `pendingAttachments`; clear together
   * with {@link pendingUserMessage}. Chips are inert on the pending bubble
   * (no execution record yet); previews and downloads light up the moment
   * the real turn replaces it.
   */
  readonly pendingAttachments?: readonly MessageAttachmentView[] | null;
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
   * Scroll to the reader's own message when they send one from a
   * scrolled-up position (stigmer-cloud#267 — the WhatsApp convention:
   * showing the result of the reader's own action is Nielsen #1
   * system-status feedback). The send moment is the
   * {@link pendingUserMessage} transition from empty to present; the pin
   * re-engages follow mode, so the optimistic bubble and the streamed
   * reply stay in view. Incoming content is unaffected — it still never
   * moves a scrolled-up reader.
   *
   * Default `true` on all three SDK thread surfaces at once — a deliberate,
   * ratified divergence from DD-011's opt-in default: the issue's whole
   * point is cross-surface consistency, and a per-surface opt-in would
   * re-create the inconsistency it fixes. Set `false` to keep today's
   * leave-the-reader-alone behavior.
   *
   * @default true
   */
  readonly scrollOnSend?: boolean;
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
  ) => boolean | void;
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
   * Opens a plan in the session panel's plan document tab — the side-by-side
   * review/refine surface. Wired to EVERY plan card: the latest opens
   * editable/buildable, a superseded plan opens read-only (the host decides
   * from the execution id). When omitted, cards fall back to the "Open full"
   * preview modal (hosts without a panel).
   *
   * Providing this also opts the thread into LIVE plan collapse: while a
   * Plan-mode turn streams its plan (detected via `findStreamingPlan`), the
   * plan message is suppressed behind a compact {@link PlanStreamingCard}
   * whose "Open plan" routes here — the host is expected to render the
   * streaming document in its plan surface. Hosts without one (this prop
   * omitted) keep the plan streaming inline, where it stays readable.
   */
  readonly onOpenPlan?: (executionId: string) => void;
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
  /** True while the approved plan is being uploaded ahead of the build turn. */
  readonly planBuildPending?: boolean;
  /**
   * Constrain thread content to a max-width reading column
   * (`max-w-3xl`, 768 px) inside the full-width scroll container —
   * the scrollbar stays at the viewport edge.
   *
   * - `"center"` — column horizontally centered (classic chat reading view).
   * - `"start"` — column anchored to the left edge, so the thread's left
   *   edge stays put when a sibling panel opens/closes beside it.
   *
   * When omitted, content spans the full width. Opt-in per DD-011 —
   * existing consumers see no layout change.
   */
  readonly contentColumn?: ThreadContentColumn;
  /**
   * Component overrides for the thread's chrome — see
   * {@link MessageThreadSlots}. Omitted slots render the built-ins;
   * omitting the prop entirely changes nothing (DD-011).
   */
  readonly slots?: MessageThreadSlots;
}

/** Reading-column alignment for {@link MessageThread} content. */
export type ThreadContentColumn = "center" | "start";

/**
 * Class set for the optional reading column — one definition shared by both
 * render paths (non-virtualized and virtualized) so their geometry can never
 * drift.
 *
 * @internal
 */
export function threadContentColumnClass(
  column: ThreadContentColumn | undefined,
): string | false {
  return column != null && cn("stg:w-full stg:max-w-3xl stg:px-4", column === "center" && "stg:mx-auto");
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
  | { readonly kind: "message"; readonly message: AgentMessage; readonly key: string; readonly isPending?: boolean; readonly isFailed?: boolean; readonly isEditable?: boolean; readonly isPlanDocument?: boolean; readonly interactionMode?: InteractionMode; readonly attachments?: readonly MessageAttachmentView[]; readonly executionId?: string }
  | { readonly kind: "tool-group"; readonly toolCalls: readonly ToolCall[]; readonly subAgentExecutions: readonly SubAgentExecution[]; readonly key: string }
  | { readonly kind: "sub-agent"; readonly subAgentExecution: SubAgentExecution; readonly key: string }
  | { readonly kind: "phase-badge"; readonly phase: ExecutionPhase; readonly key: string }
  | { readonly kind: "execution-error"; readonly error: string; readonly retryMessage?: string; readonly key: string }
  | { readonly kind: "approval-request"; readonly pendingApproval: PendingApproval; readonly key: string }
  | { readonly kind: "file-review-record"; readonly fileChangeSet: FileChangeSet; readonly key: string }
  | { readonly kind: "setup-progress"; readonly workspaceEntries: readonly WorkspaceEntry[]; readonly serverPhase?: string; readonly isAwaitingResponse?: boolean; readonly key: string }
  | { readonly kind: "recalled-memories"; readonly report: RecalledMemoriesReport; readonly facts: readonly RecalledMemoryFact[]; readonly key: string }
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
      /**
       * The plan's title (its leading `# H1`), lifted from the plan message at
       * build time — no fetch. Present only when the turn published an
       * artifact (the collapsed-card path); the card falls back to "Plan".
       */
      readonly planTitle?: string;
      /**
       * True for the most recent completed Plan execution in the thread — the
       * only plan whose card carries the primary "Build" action. Superseded
       * plans keep their review actions (open/download) but never a build
       * CTA, so a stale plan can't be implemented by accident.
       */
      readonly isLatestPlan: boolean;
    }
  | {
      /**
       * A plan the active Plan-mode execution is writing RIGHT NOW: the
       * streaming plan message is suppressed and this compact card stands in
       * while the document renders live in the panel's plan tab. On
       * completion the item becomes `plan-completion` — a different kind
       * under the SAME key, so the card holds one thread position and the
       * swap reads as the card settling.
       */
      readonly kind: "plan-writing";
      readonly key: string;
      readonly executionId: string;
      /** Live title (the plan's leading `# H1`), growing as it streams. */
      readonly planTitle?: string;
      /** Length of the plan text streamed so far (drives the live size). */
      readonly planSize: number;
    }
  | {
      /**
       * The ambient-liveness status line at the thread's tail (stigmer#277):
       * emitted while the active execution is IN_PROGRESS with no running
       * tool call, no live sub-agent, and no pending approval — the quiet
       * stretches where the screen would otherwise be completely still.
       */
      readonly kind: "liveness";
      readonly key: string;
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
 * True while the active execution already shows a live signal of its own
 * somewhere in the thread — a RUNNING tool call (its row's label carries the
 * shimmer) or an in-flight sub-agent (its section carries a live indicator).
 * Suppresses the bottom liveness line: one ambient signal at a time, riding
 * the words closest to the actual activity.
 */
function hasVisiblyRunningActivity(execution: AgentExecution): boolean {
  for (const sub of execution.status?.subAgentExecutions ?? []) {
    if (
      sub.status === SubAgentStatus.SUB_AGENT_IN_PROGRESS ||
      sub.status === SubAgentStatus.SUB_AGENT_PENDING
    ) {
      return true;
    }
  }
  for (const msg of execution.status?.messages ?? []) {
    for (const tc of msg.toolCalls) {
      if (tc.status === ToolCallStatus.TOOL_CALL_RUNNING) return true;
    }
  }
  return false;
}

/**
 * True for an execution that ran in Plan mode and completed — the only kind of
 * execution that has a reviewable plan (streaming/failed/terminated Plan turns
 * have nothing final to review or build from).
 */
function isCompletedPlanExecution(execution: AgentExecution): boolean {
  return (
    execution.status?.phase === ExecutionPhase.EXECUTION_COMPLETED &&
    execution.spec?.executionConfig?.interactionMode === InteractionMode.PLAN
  );
}

/**
 * Index of the message that IS the plan in a completed Plan execution: the
 * last AI message with content — the SAME selection rule the runner's
 * `extractFinalPlanText` uses to publish `plan.md`, so the message promoted to
 * a document in the thread is byte-identical to the published artifact.
 * Returns -1 when no such message exists.
 */
function findPlanMessageIndex(messages: readonly AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === MessageType.MESSAGE_AI && msg.content.trim().length > 0) {
      return i;
    }
  }
  return -1;
}

/**
 * The plan's title for its compact card: the leading `# H1` of the plan
 * message, after the same plan-scoped bare-fence unwrap the document renderers
 * apply — so the card and the plan tab always agree on the title. `undefined`
 * when the plan has no H1 (the card falls back to "Plan").
 */
function extractPlanTitle(content: string): string | undefined {
  return extractLeadingH1(unwrapEnclosingMarkdownFence(content, true)).title ?? undefined;
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
  collapseStreamingPlan = false,
  pendingAttachments?: readonly MessageAttachmentView[] | null,
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

  // The most recent completed Plan execution owns the primary "Build" action;
  // every earlier plan renders as a review-only record. Resolved up front so
  // each segment can stamp its own card with the right authority.
  let latestPlanExecutionId: string | null = null;
  for (let i = allExecutions.length - 1; i >= 0; i--) {
    if (isCompletedPlanExecution(allExecutions[i])) {
      latestPlanExecutionId = allExecutions[i].metadata?.id ?? `_e${i}`;
      break;
    }
  }

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

    // A completed Plan turn collapses its plan message into the compact plan
    // card (the plan-completion item): the document lives in the panel's plan
    // tab, not the thread. While the plan is still streaming, the same
    // treatment applies live when the host has a plan surface (streamingPlan
    // below): the in-flight plan message is suppressed behind a plan-writing
    // card while the panel's plan tab renders it as it streams — the content
    // moves, it doesn't disappear. Completion swaps the live card for the
    // settled one (same key), and the paired auto-open (useSessionPanel's
    // planKey trigger) keeps the document side-by-side. Collapse of a
    // COMPLETED plan is gated on the ARTIFACT existing: a plan that never
    // published (older executions, failed upload) exists only in the message,
    // so that path keeps the inline document promotion (isPlanDocument) —
    // collapsing it would orphan the plan behind a card with nothing to open.
    const isCompletedPlanExec = isCompletedPlanExecution(exec);
    const planMessageIndex = isCompletedPlanExec
      ? findPlanMessageIndex(messages)
      : -1;
    const planArtifact = isCompletedPlanExec
      ? findPlanArtifact(exec)
      : undefined;
    const collapsePlanMessage =
      planMessageIndex >= 0 && planArtifact !== undefined;

    // The plan the active Plan-mode turn is writing RIGHT NOW (detected by
    // the H1 convention — see findStreamingPlan). Its message is suppressed
    // in favor of a live plan-writing card, mirroring the completed-turn
    // collapse above, while the panel's plan tab renders the document live.
    // Two gates: collapseStreamingPlan (the host wired onOpenPlan — without a
    // document surface the plan must keep streaming inline, DD-011) and
    // isActiveStreamExec (a stale non-terminal execution left in the
    // completed list by the transient skew documented above must never
    // sprout a live card). Mutually exclusive with collapsePlanMessage by
    // construction: one requires a terminal phase, the other forbids it.
    const streamingPlan =
      collapseStreamingPlan && isActiveStreamExec
        ? findStreamingPlan(exec)
        : undefined;

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

    // The user-turn synthesis rule (empty / "execute" placeholder /
    // Build-from-plan skips) is the shared conversation rule — see
    // syntheticUserPrompt in @stigmer/sdk for the why of each skip.
    const promptText = syntheticUserPrompt(exec);
    if (promptText) {
      const syntheticHumanMsg = create(AgentMessageSchema);
      syntheticHumanMsg.type = MessageType.MESSAGE_HUMAN;
      syntheticHumanMsg.content = promptText;

      // When the active stream execution's spec message matches the
      // pending user message, use a shared bridging key so React
      // updates the pending bubble in place instead of remounting.
      const bridgePending =
        isActiveStreamExec &&
        pendingUserMessage != null &&
        promptText === pendingUserMessage;

      // The turn's submitted files (spec.attachments, by reference — the spec
      // never mutates and structural sharing keeps the ref stable, so the
      // memoized bubble skips re-renders). The execution id rides along for
      // the presigned-URL affordances; the `_e${ei}` synthetic fallback is
      // display-only and must never be presigned against.
      const specAttachments = exec.spec?.attachments;
      items.push({
        kind: "message",
        message: syntheticHumanMsg,
        key: bridgePending ? "pending-user-turn" : `${execId}-spec`,
        // The active execution's prompt is the one a user can edit-and-resubmit
        // (stop + rephrase). Only mark it when the consumer enabled editing.
        isEditable: isActiveStreamExec && editableActiveTurn,
        // The turn's mode marks the prompt bubble (a "Plan" pill on Plan
        // turns) so the transcript reads unambiguously after mode switches.
        interactionMode: exec.spec?.executionConfig?.interactionMode,
        attachments:
          specAttachments && specAttachments.length > 0
            ? specAttachments
            : undefined,
        executionId: exec.metadata?.id,
      });
    }

    // The retriever transparency card (stigmer#293 Phase 3a, DD-008 D5):
    // this execution ran semantic selection over its memory snapshot, so
    // its segment discloses the subset right after the user's turn —
    // spec.message is the query the retriever embedded. Absent report or
    // selection_active=false means wholesale (unchanged Phase 2 behavior)
    // and renders nothing. Gated on the REPORT, not the prompt bubble:
    // syntheticUserPrompt deliberately skips some user turns (empty
    // prompt, build-from-plan) that can still be selection-active.
    const recalledReport = exec.status?.recalledMemoriesReport;
    if (recalledReport?.selectionActive) {
      items.push({
        kind: "recalled-memories",
        report: recalledReport,
        facts: exec.spec?.recalledMemories?.facts ?? [],
        key: `${execId}-recalled-memories`,
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
        // The collapsed plan message is not rendered — the plan-completion
        // card at the segment's end is the turn's sole plan representation.
        // Its tool calls (below) and the todo anchor still process normally.
        // A STREAMING plan message is suppressed the same way: its stand-in
        // is the plan-writing card at the segment's end, and the document
        // renders live in the panel's plan tab.
        const suppressAsPlan =
          (collapsePlanMessage && mi === planMessageIndex) ||
          mi === streamingPlan?.messageIndex;
        if (!suppressAsPlan) {
          items.push({
            kind: "message",
            message: msg,
            key: `${execId}-m${mi}`,
            isPlanDocument: !collapsePlanMessage && mi === planMessageIndex,
          });
        }
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

    // A completed Plan turn closes its segment with the plan card — the
    // compact stand-in for the collapsed plan message, carrying the title the
    // message would have shown. Every plan stays reviewable forever; only the
    // latest carries the build authority (isLatestPlan). A superseded plan
    // that never published an artifact is skipped — with no artifact and no
    // build CTA it would render an empty shell.
    if (isCompletedPlanExec) {
      const isLatestPlan = execId === latestPlanExecutionId;
      if (planArtifact || isLatestPlan) {
        items.push({
          kind: "plan-completion",
          key: `${execId}-plan-completion`,
          executionId: exec.metadata?.id ?? "",
          planArtifact,
          planTitle: collapsePlanMessage
            ? extractPlanTitle(messages[planMessageIndex].content)
            : undefined,
          isLatestPlan,
        });
      }
    } else if (streamingPlan) {
      // The live stand-in for the suppressed streaming plan message. It
      // deliberately SHARES the completion item's key: on completion this
      // item becomes the plan-completion item above (a kind change under a
      // stable key), so the card holds one thread position and the handoff
      // reads as the card settling rather than a new element appearing.
      items.push({
        kind: "plan-writing",
        key: `${execId}-plan-completion`,
        executionId: exec.metadata?.id ?? "",
        planTitle:
          extractLeadingH1(streamingPlan.displayText).title ?? undefined,
        planSize: streamingPlan.displayText.length,
      });
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

    // The server populates `status.error` on EXECUTION_FAILED and
    // EXECUTION_TERMINATED — never on a user-initiated cancel. Surface it
    // beside the badge so a failure that produced no messages still explains
    // itself (the CLI shows this reason; the chat previously showed nothing).
    // Kept as its own item so the badge component stays presentational.
    //
    // CANCELLED is carved out: cancel is a quiet terminal state, not a failure
    // (stigmer#282). A CANCELLED execution can still carry a non-empty error —
    // cancel preserves a preexisting error by design (merge semantics), and an
    // older server may have written a "Execution cancelled" sentinel — so the
    // phase, not the error field, decides whether to render the loud banner.
    // The muted Cancelled phase badge above remains the visible state.
    const reason = lastExec?.status?.error;
    if (reason && lastPhase !== ExecutionPhase.EXECUTION_CANCELLED) {
      const specMessage = lastExec?.spec?.message;
      // A failed build turn offers no inline Retry: resending its label as an
      // ordinary message would drop the buildFromPlan flag (no runner
      // directive, no plan attachment). The plan card above the error is the
      // fully-wired retry — its Build button re-runs the whole pipeline.
      const isBuildTurn =
        lastExec?.spec?.executionConfig?.buildFromPlan === true;
      items.push({
        kind: "execution-error",
        error: reason,
        retryMessage:
          specMessage && specMessage !== "execute" && !isBuildTurn
            ? specMessage
            : undefined,
        key: `execution-error-${lastExec?.metadata?.id ?? lastPhase}`,
      });
    }
  }

  // Plan cards are emitted inside each execution's segment (see the
  // isCompletedPlanExec block in the loop above) — attached to their plan
  // document, persistent across later turns, never appended at the tail.

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

  // The ambient-liveness line (stigmer#277): the thread's tail is never a
  // dead frame while the agent is alive. Emitted only when
  //  - the execution is IN_PROGRESS (phase-driven, DD-009 — WAITING/PAUSED
  //    mean the agent is NOT working, and shimmering there would lie),
  //  - it is past the pre-first-content window (setup-progress owns that),
  //  - nothing else on screen carries its own live signal (a running tool
  //    row or live sub-agent — one ambient signal at a time), and
  //  - no approval is pending (the gate card is the louder, truthful state).
  // Model-generation gaps between tool calls — the exact moments users doubt
  // the agent — are precisely what remains.
  if (
    activeStreamExecution &&
    hasStartedResponding(activeStreamExecution) &&
    activeStreamExecution.status?.phase === ExecutionPhase.EXECUTION_IN_PROGRESS &&
    (activeStreamExecution.status.pendingApprovals?.length ?? 0) === 0 &&
    !hasVisiblyRunningActivity(activeStreamExecution)
  ) {
    items.push({ kind: "liveness", key: "liveness-status" });
  }

  if (pendingUserMessage) {
    // A FAILED send never created an execution, so an existing execution with
    // identical text (e.g. two build attempts of the same plan — both
    // "Build from plan") must never swallow the failed bubble. Suppression
    // only applies to the succeeded-send window where the stream has
    // delivered the same turn but the pending state hasn't cleared yet.
    const alreadySynthesized =
      !pendingMessageFailed && lastExec?.spec?.message === pendingUserMessage;
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
        // The submit context's attachments: evidence the files rode with the
        // turn, kept on failure so retry shows what will be re-sent. No
        // executionId yet — chips render inert until the real turn (same
        // bridge key) replaces this bubble and brings the presign seam.
        attachments:
          pendingAttachments && pendingAttachments.length > 0
            ? pendingAttachments
            : undefined,
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
  pendingAttachments,
  pendingMessageFailed = false,
  onRetrySend,
  scrollOnSend = true,
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
  onOpenPlan,
  org,
  planActionsDisabled,
  planBuildPending,
  contentColumn,
  slots,
}: MessageThreadProps) {
  useRenderTracer("MessageThread", { executions, activeStreamExecution });

  const includeApprovals = onApprovalSubmit != null;
  const editableActiveTurn = onEditMessage != null;
  // A streaming plan is collapsed behind its live card only when the host can
  // open the plan document surface — a panel-less host (no onOpenPlan) keeps
  // the plan streaming inline, where it remains readable (DD-011).
  const collapseStreamingPlan = onOpenPlan != null;
  const items = useMemo(
    () => buildThreadItems(executions, activeStreamExecution, pendingUserMessage, includeApprovals, workspaceEntries, summarizationEvents, pendingMessageFailed, editableActiveTurn, showFileReviewRecords, collapseStreamingPlan, pendingAttachments),
    [executions, activeStreamExecution, pendingUserMessage, includeApprovals, workspaceEntries, summarizationEvents, pendingMessageFailed, editableActiveTurn, showFileReviewRecords, collapseStreamingPlan, pendingAttachments],
  );

  useKeyStability(items);

  // Scroll-on-send (stigmer-cloud#267): the send moment is the optimistic
  // message's empty→present transition — the one signal both render paths
  // share. A monotonic counter (not the message text) carries it down, so
  // repeated sends of identical text still pin and a retry of a FAILED send
  // (pending stays present throughout) deliberately does not re-pin.
  const [sendSignal, setSendSignal] = useState(0);
  const wasPendingRef = useRef(false);
  useEffect(() => {
    const isPending = !!pendingUserMessage;
    if (isPending && !wasPendingRef.current) {
      setSendSignal((n) => n + 1);
    }
    wasPendingRef.current = isPending;
  }, [pendingUserMessage]);
  const pinToLatestSignal = scrollOnSend ? sendSignal : undefined;

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
      <div className={cn("stg:relative stg:min-h-0", className)}>
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
            onOpenPlan={onOpenPlan}
            org={org}
            planActionsDisabled={planActionsDisabled}
            planBuildPending={planBuildPending}
            contentColumn={contentColumn}
            onRetrySend={onRetrySend}
            onRetryExecution={onRetryExecution}
            onEditMessage={onEditMessage}
            slots={slots}
            pinToLatestSignal={pinToLatestSignal}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <NonVirtualizedThread
      items={items}
      className={className}
      contentColumn={contentColumn}
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
      onOpenPlan={onOpenPlan}
      org={org}
      planActionsDisabled={planActionsDisabled}
      planBuildPending={planBuildPending}
      onRetrySend={onRetrySend}
      onRetryExecution={onRetryExecution}
      onEditMessage={onEditMessage}
      slots={slots}
      pinToLatestSignal={pinToLatestSignal}
    />
  );
}

// ---------------------------------------------------------------------------
// NonVirtualizedThread — original scroll-container rendering path
// ---------------------------------------------------------------------------

interface NonVirtualizedThreadProps {
  readonly items: readonly ThreadItem[];
  readonly className?: string;
  readonly contentColumn?: ThreadContentColumn;
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
  readonly onOpenPlan?: (executionId: string) => void;
  readonly org?: string;
  readonly planActionsDisabled?: boolean;
  /** True while the approved plan is being uploaded ahead of the build turn. */
  readonly planBuildPending?: boolean;
  readonly onRetrySend?: () => void;
  readonly onRetryExecution?: (message: string) => void;
  readonly onEditMessage?: (text: string) => void;
  readonly slots?: MessageThreadSlots;
  /** Scroll-on-send counter from the parent (see `usePinToLatestOnSignal`). */
  readonly pinToLatestSignal?: number;
}

function NonVirtualizedThread({
  items,
  className,
  contentColumn,
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
  onOpenPlan,
  org,
  planActionsDisabled,
  planBuildPending,
  onRetrySend,
  onRetryExecution,
  onEditMessage,
  slots,
  pinToLatestSignal,
}: NonVirtualizedThreadProps) {
  const { scrollRef, sentinelRef, contentRef, isFollowing, jumpToLatest } =
    useAutoScroll();
  usePinToLatestOnSignal(pinToLatestSignal, jumpToLatest);

  useDomNodeCount(scrollRef, "MessageThread");

  return (
    <div className={cn("stg:relative stg:min-h-0", className)}>
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className={cn(
          "stg:h-full stg:overflow-y-auto stg:pt-6 stg:pb-4 stg:[overflow-anchor:none]",
          "stg:[scrollbar-width:thin] stg:[scrollbar-color:var(--color-border)_transparent]",
          "stg:[&::-webkit-scrollbar]:w-1.5",
          "stg:[&::-webkit-scrollbar-track]:bg-transparent",
          "stg:[&::-webkit-scrollbar-thumb]:rounded-full stg:[&::-webkit-scrollbar-thumb]:bg-border/40",
        )}
      >
        <SandboxContext.Provider value={sandboxCtx}>
        <FilePathContext.Provider value={filePathCtx}>
        <ApprovalContext.Provider value={approvalCtx}>
        <FileReviewContext.Provider value={fileReviewCtx}>
        <DevProfiler id="MessageThread">
          <div ref={contentRef} className={cn("stg:flex stg:flex-col stg:gap-4", threadContentColumnClass(contentColumn))}>
            {items.map((item) => (
              <ThreadItemWrapper key={item.key} animate>
                <ThreadItemRenderer
                  item={item}
                  formatToolCallSummary={formatToolCallSummary}
                  onApprovalSubmit={onApprovalSubmit}
                  submittingApprovalIds={submittingApprovalIds}
                  approvalErrors={approvalErrors}
                  onBuildFromPlan={onBuildFromPlan}
                  onOpenPlan={onOpenPlan}
                  org={org}
                  planActionsDisabled={planActionsDisabled}
                  planBuildPending={planBuildPending}
                  onRetrySend={onRetrySend}
                  onRetryExecution={onRetryExecution}
                  onEditMessage={onEditMessage}
                  slots={slots}
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
  readonly onOpenPlan?: (executionId: string) => void;
  readonly org?: string;
  readonly planActionsDisabled?: boolean;
  /** True while the approved plan is being uploaded ahead of the build turn. */
  readonly planBuildPending?: boolean;
  readonly onRetrySend?: () => void;
  readonly onRetryExecution?: (message: string) => void;
  readonly onEditMessage?: (text: string) => void;
  readonly slots?: MessageThreadSlots;
}

/**
 * Renders a single thread item by discriminated `kind`. Used by both
 * the non-virtualized `items.map()` path and the virtualized
 * `Virtuoso.itemContent` callback.
 *
 * Slot resolution happens here, per case, as `slots?.X ?? X` — no merged
 * defaults object, no allocation, and the memoized row wrappers below
 * (`ApprovalCardRow`, `FileReviewRecordRow`) keep their DD-010 callback
 * stabilization around whichever component renders inside them.
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
  onOpenPlan,
  org,
  planActionsDisabled,
  planBuildPending,
  onRetrySend,
  onRetryExecution,
  onEditMessage,
  slots,
}: ThreadItemRendererProps) {
  switch (item.kind) {
    case "message": {
      const Entry = slots?.MessageEntry ?? MessageEntry;
      if (item.isFailed) {
        return (
          <FailedUserMessage
            message={item.message}
            attachments={item.attachments}
            onRetry={onRetrySend}
            MessageEntryComponent={Entry}
          />
        );
      }
      return (
        <Entry
          message={item.message}
          className={item.isPending ? "stg:opacity-70" : undefined}
          isPlanDocument={item.isPlanDocument}
          interactionMode={item.interactionMode}
          attachments={item.attachments}
          executionId={item.executionId}
          onEdit={
            item.isEditable && onEditMessage
              ? () => onEditMessage(item.message.content)
              : undefined
          }
        />
      );
    }
    case "tool-group":
      return (
        <ToolCallGroup
          toolCalls={item.toolCalls}
          subAgentExecutions={item.subAgentExecutions}
          formatSummary={formatToolCallSummary}
          className="stg:mx-4"
        />
      );
    case "sub-agent":
      return (
        <SubAgentSection
          subAgentExecution={item.subAgentExecution}
          className="stg:mx-4"
        />
      );
    case "phase-badge":
      return (
        <div className="stg:flex stg:justify-center stg:py-3">
          <ExecutionPhaseBadge phase={item.phase} />
        </div>
      );
    case "execution-error": {
      const ErrorNotice = slots?.ExecutionErrorNotice ?? ExecutionErrorNotice;
      return (
        <ErrorNotice
          error={item.error}
          retryMessage={item.retryMessage}
          onRetry={onRetryExecution}
        />
      );
    }
    case "approval-request":
      return (
        <ApprovalCardRow
          pendingApproval={item.pendingApproval}
          onApprovalSubmit={onApprovalSubmit!}
          isSubmitting={submittingApprovalIds?.has(item.pendingApproval.toolCallId) ?? false}
          error={approvalErrors?.get(item.pendingApproval.toolCallId) ?? null}
          ApprovalCardComponent={slots?.ApprovalCard ?? ApprovalCard}
        />
      );
    case "file-review-record":
      return <FileReviewRecordRow fileChangeSet={item.fileChangeSet} />;
    case "setup-progress": {
      const Setup = slots?.SetupProgress ?? SetupProgress;
      return (
        <Setup
          workspaceEntries={item.workspaceEntries}
          serverPhase={item.serverPhase}
          isAwaitingResponse={item.isAwaitingResponse}
        />
      );
    }
    case "recalled-memories": {
      const Recalled = slots?.RecalledMemoriesCard ?? RecalledMemoriesCard;
      return <Recalled report={item.report} facts={item.facts} />;
    }
    case "context-compacted":
      return <SummarizationCard event={item.event} />;
    case "liveness": {
      const Liveness = slots?.LivenessStatusLine ?? LivenessStatusLine;
      return <Liveness />;
    }
    case "todos": {
      const Todos = slots?.TodoCard ?? TodoCard;
      return <Todos todos={item.todos} className="stg:mx-4" TodoRow={slots?.TodoRow} />;
    }
    case "plan-completion": {
      // When the plan was published as an artifact, show the richer reviewable
      // card (preview / copy / download / implement). Otherwise fall back to the
      // bare Implement CTA (older executions, or a plan that failed to publish).
      // Only the latest plan receives the build action — a superseded plan's
      // card is review-only, so a stale plan can never be implemented from it.
      const Artifact = slots?.PlanArtifactCard ?? PlanArtifactCard;
      const Completion = slots?.PlanCompletionCard ?? PlanCompletionCard;
      return item.planArtifact && item.executionId ? (
        <Artifact
          executionId={item.executionId}
          artifact={item.planArtifact}
          title={item.planTitle}
          org={org}
          onImplement={item.isLatestPlan ? onBuildFromPlan : undefined}
          // Every card routes to the plan document tab — the host renders a
          // superseded plan read-only there (it receives the execution id).
          onOpenPlan={
            onOpenPlan
              ? () => onOpenPlan(item.executionId)
              : undefined
          }
          disabled={planActionsDisabled}
          buildPending={planBuildPending}
        />
      ) : (
        <Completion
          onImplement={item.isLatestPlan ? onBuildFromPlan : undefined}
          disabled={planActionsDisabled}
        />
      );
    }
    case "plan-writing": {
      // The live stand-in for a plan the active turn is writing. Emitted only
      // when onOpenPlan is wired (see buildThreadItems' collapseStreamingPlan
      // gate), so the action is always available in practice.
      const Streaming = slots?.PlanStreamingCard ?? PlanStreamingCard;
      return (
        <Streaming
          title={item.planTitle}
          sizeBytes={item.planSize}
          onOpenPlan={
            onOpenPlan ? () => onOpenPlan(item.executionId) : undefined
          }
        />
      );
    }
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
 *
 * The bubble renders through the caller-resolved MessageEntry slot so an
 * overridden bubble style also applies to failed sends.
 */
function FailedUserMessage({
  message,
  attachments,
  onRetry,
  MessageEntryComponent,
}: {
  message: AgentMessage;
  attachments?: readonly MessageAttachmentView[];
  onRetry?: () => void;
  MessageEntryComponent: ComponentType<MessageEntryProps>;
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-1">
      {/* Attachments stay visible on the failed bubble — the one turn where
          the user most needs evidence of what they tried to send (and what
          Retry will re-send). No executionId: the send never created one. */}
      <MessageEntryComponent message={message} attachments={attachments} />
      <div
        role="alert"
        className="stg:mx-4 stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-destructive"
      >
        <span className="stg:min-w-0 stg:flex-1 stg:truncate">Couldn&rsquo;t send.</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="stg:shrink-0 stg:rounded stg:font-medium stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            Retry
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
  // The (possibly slotted) card component. The row's callback stabilization
  // wraps whichever card renders, so a slot override keeps the memo behavior.
  readonly ApprovalCardComponent: ComponentType<ApprovalCardProps>;
}

const ApprovalCardRow = memo(function ApprovalCardRow({
  pendingApproval,
  onApprovalSubmit,
  isSubmitting,
  error = null,
  ApprovalCardComponent,
}: ApprovalCardRowProps) {
  const handleSubmit = useCallback(
    (action: ApprovalAction, comment?: string) => {
      onApprovalSubmit(pendingApproval.toolCallId, action, comment);
    },
    [onApprovalSubmit, pendingApproval.toolCallId],
  );

  return (
    <ApprovalCardComponent
      pendingApproval={pendingApproval}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      error={error}
      className="stg:mx-4"
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
      className="stg:mx-4"
    />
  );
});
