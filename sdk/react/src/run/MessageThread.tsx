"use client";

import { lazy, memo, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { RecalledMemoryFact } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import type { FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  InteractionMode,
  RunPhase,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  deletedReferenceLabel,
  displayFileChangeSets,
  isBackgroundRunning,
  isDeletedReference,
  syntheticUserPrompt,
  type CompactedItem,
  type FileReviewSet,
  type MemoryRecall,
  type Thread,
  type Todo,
  type ToolUse,
  type QueuedMessage,
  type Turn,
  type TurnItem,
} from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { runPhaseOf } from "./run-phases.js";
import { MessageEntry, type MessageEntryProps, type ThreadMessage } from "./MessageEntry.js";
import { RunScores } from "../score/RunScores.js";
import { RunScoresProvider, useRunScoresEnabled } from "../score/RunScoresContext.js";
import { messageFileViews, type MessageFileView } from "./MessageFiles.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { SubagentSection, subagentSubjectOf } from "./SubagentSection.js";
import { RunPhaseBadge } from "./RunPhaseBadge.js";
import { SetupProgress, type SetupProgressProps } from "./SetupProgress.js";
import { RecalledMemoriesCard, type RecalledMemoriesCardProps } from "./RecalledMemoriesCard.js";
import {
  LivenessStatusLine,
  type LivenessStatusLineProps,
} from "./LivenessStatusLine.js";
import { ApprovalCard, type ApprovalCardProps } from "./ApprovalCard.js";
import { RunErrorNotice, type RunErrorNoticeProps } from "./RunErrorNotice.js";
import { FileReviewCard } from "./FileReviewCard.js";
import { SummarizationCard } from "./SummarizationCard.js";
import { PlanCompletionCard, type PlanCompletionCardProps } from "./PlanCompletionCard.js";
import { PlanFileCard, type PlanFileCardProps } from "./PlanFileCard.js";
import { PlanStreamingCard, type PlanStreamingCardProps } from "./PlanStreamingCard.js";
import { TodoCard, type TodoCardProps } from "./TodoCard.js";
import type { TodoRowProps } from "./TodoList.js";
import { findStreamingPlan } from "../library/detect-streaming-plan.js";
import { extractPrimaryArg, isInternalTool, resolveToolCategoryFromCall } from "./tool-categories.js";
import { fileForRowPath } from "./file-review-status.js";
import type { ToolUseAnswer } from "./useAnswerToolUse.js";
import { FilePathContext, type FilePathContextValue } from "./FilePathContext.js";
import type { ResolvedPathAction } from "./file-path-resolver.js";
import { SandboxContext, type SandboxContextValue } from "./SandboxContext.js";
import { ApprovalContext, type ApprovalContextValue } from "./ApprovalContext.js";
import { BackgroundCommandContext, type BackgroundCommandContextValue } from "./BackgroundCommandContext.js";
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

/** Stable empty collections so a thread without answers or runs keeps referential identity. */
const EMPTY_SUBMITTING_IDS: ReadonlySet<string> = new Set();
const EMPTY_ANSWER_ERRORS: ReadonlyMap<string, Error> = new Map();
const EMPTY_RUNS: readonly Run[] = [];

/**
 * Component overrides for the chrome {@link MessageThread} renders — the
 * adaptation surface for hosts whose design system needs different
 * *structure*, not just different `--stgm-*` token values (stigmer#187).
 *
 * Each slot is keyed by the built-in component it replaces and receives
 * exactly that component's exported props interface, so an override can
 * always delegate to the built-in for the cases it does not customize
 * (e.g. a `MessageEntry` slot that restyles a person's messages and renders
 * the default `MessageEntry` for everything else).
 *
 * Define slot components at module level (or memoize them). The thread's
 * rows rely on `React.memo` and the session fold's shared references to skip
 * re-renders during streaming; a slot component recreated on every host
 * render defeats that for its rows.
 */
export interface MessageThreadSlots {
  /**
   * All message bubbles — a person's messages, the agent's messages,
   * thinking, and platform notes. Also wraps the failed-send bubble (the
   * inline Retry chrome around it stays built-in).
   */
  readonly MessageEntry?: ComponentType<MessageEntryProps>;
  /** The card for a tool use that waits for a person, when it has no row of its own. */
  readonly ApprovalCard?: ComponentType<ApprovalCardProps>;
  /** The collapsible in-thread to-dos card. */
  readonly TodoCard?: ComponentType<TodoCardProps>;
  /**
   * One to-do row inside the built-in {@link TodoCard}'s list. Ignored
   * when `TodoCard` is also overridden (the replacement receives it via
   * {@link TodoCardProps.TodoRow} and may forward or ignore it).
   */
  readonly TodoRow?: ComponentType<TodoRowProps>;
  /** Completed Plan turn that returned a plan File. */
  readonly PlanFileCard?: ComponentType<PlanFileCardProps>;
  /** Completed Plan turn without a plan File — the bare Implement CTA. */
  readonly PlanCompletionCard?: ComponentType<PlanCompletionCardProps>;
  /** Live stand-in card while a Plan turn is writing its document. */
  readonly PlanStreamingCard?: ComponentType<PlanStreamingCardProps>;
  /** Pre-first-token setup / "Thinking…" indicator. */
  readonly SetupProgress?: ComponentType<SetupProgressProps>;
  /**
   * The retriever transparency card at a selection-active turn's
   * segment start — "Recalled N of M memories".
   */
  readonly RecalledMemoriesCard?: ComponentType<RecalledMemoriesCardProps>;
  /**
   * The terminal turn-failure notice. Receives the raw server-reported
   * reason and the retry wiring, so a host can turn the failure into its own
   * recovery moment (classify the reason, offer another harness, link
   * support) instead of the built-in Show more / Retry treatment.
   */
  readonly RunErrorNotice?: ComponentType<RunErrorNoticeProps>;
  /**
   * The ambient-liveness status line at the thread's tail while the active
   * turn is live between visible events (stigmer#277). Override to
   * supply a host-voiced label or richer treatment; the emission policy
   * (when the line appears at all) stays with the thread.
   */
  readonly LivenessStatusLine?: ComponentType<LivenessStatusLineProps>;
}

/** Props for {@link MessageThread}. */
export interface MessageThreadProps {
  /**
   * The conversation's turns, in order: the session's events folded
   * (`useSessionConversation().turns`, or `useSessionEvents().fold.turns`).
   * Each turn renders its person's message, the agent's items, its asks,
   * to-dos and file reviews. A turn that has not ended is the live one.
   */
  readonly turns: readonly Turn[];
  /**
   * The turns' runs, for what the run record holds and the events do not:
   * the message's files and mode, the agent and
   * skill versions a turn ran, its setup progress, and the captured bytes
   * of its file changes. Matched to turns by run id; a turn whose run is
   * absent renders from its events alone.
   */
  readonly runs?: readonly Run[];
  /**
   * Each completed Plan-mode turn's plan File, by run id (`planFilesByRun`
   * over the conversation's Files). A turn with a plan File collapses its
   * plan message into the plan card; a turn without one (or a host that
   * passes none) renders the plan message as the document itself.
   */
  readonly planFiles?: ReadonlyMap<string, StigmerFile>;
  /**
   * Optimistic user message shown at the end of the thread before the
   * session's events carry it. Rendered as a person's message with a
   * sending indicator. Clear this prop once the turn appears.
   */
  readonly pendingUserMessage?: string | null;
  /**
   * Files sent with the pending user message, rendered as chips
   * on the optimistic bubble so the files never vanish between submit and
   * the turn appearing (stigmer/stigmer#372). Supply
   * {@link useSessionConversation}'s `pendingFiles`; clear together
   * with {@link pendingUserMessage}. Chips are inert on the pending bubble
   * (no run record yet); previews and downloads light up the moment
   * the real turn replaces it.
   */
  readonly pendingFiles?: readonly MessageFileView[] | null;
  /**
   * Messages sent while a turn worked that no turn has read yet
   * (`useSessionConversation`'s `queued`), rendered dimmed after the
   * thread: "Queued", read at the agent's next step, or "Not read" once a
   * stop dropped it. A message a turn reads moves into that turn.
   */
  readonly queued?: readonly QueuedMessage[];
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
   * scrolled-up position (the WhatsApp convention:
   * showing the result of the reader's own action is Nielsen #1
   * system-status feedback). The send moment is the
   * {@link pendingUserMessage} transition from empty to present; the pin
   * re-engages follow mode, so the optimistic bubble and the streamed
   * reply stay in view. Incoming content is unaffected — it still never
   * moves a scrolled-up reader.
   *
   * Default `true` on all three SDK thread surfaces at once — a deliberate
   * exception to opt-in defaults: cross-surface consistency is the point,
   * and a per-surface opt-in would re-create the inconsistency it fixes.
   * Set `false` to keep today's leave-the-reader-alone behavior.
   *
   * @default true
   */
  readonly scrollOnSend?: boolean;
  /**
   * When provided, the live turn's message (the person's prompt) shows a
   * hover "Edit" affordance. Clicking it invokes this callback with the
   * message text — the session chat stops the turn and pre-fills the
   * composer for an edit-and-resubmit.
   *
   * Provide this only while the live turn is stoppable; the SDK marks
   * exactly the live turn's message editable. When omitted, no edit
   * control is shown.
   */
  readonly onEditMessage?: (text: string) => void;
  /**
   * Retry handler for a turn that failed with a server error reason.
   * Receives the originating message; the consumer typically resends it as
   * a new turn. When omitted, no Retry control is shown beside the surfaced
   * failure reason.
   */
  readonly onRetryRun?: (message: string) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Custom formatter for a folded run of tool calls' label. Passed through
   * to each {@link ToolCallGroup}.
   */
  readonly formatToolCallSummary?: (toolUses: readonly ToolUse[]) => string;
  /**
   * Answers a tool use that waits for a person (allow, deny with an
   * optional reason, or grant its class). When provided, a waiting tool use
   * renders its decision inline on its own row (and as a bottom
   * {@link ApprovalCard} when it has none). When omitted, no decision UI is
   * shown.
   */
  readonly onAnswerToolUse?: (toolUseId: string, answer: ToolUseAnswer, denyMessage?: string) => void;
  /**
   * The tool uses whose answer is in flight, by id. Drives per-gate
   * loading state. Only meaningful when `onAnswerToolUse` is provided.
   */
  readonly answeringToolUseIds?: ReadonlySet<string>;
  /**
   * Each tool use's last failed answer, keyed by its id — surfaced in-card
   * beside the gate that failed. Supply {@link useAnswerToolUse}'s
   * `errorsByToolUseId`. Only meaningful when `onAnswerToolUse` is provided.
   */
  readonly answerErrors?: ReadonlyMap<string, Error>;
  /**
   * Stops one command the agent runs in the background, by the tool use
   * that started it. When provided, a running command's row, and the
   * thread's tail line while the turn waits only on such commands, offer
   * Stop; when omitted, none is shown.
   */
  readonly onStopBackgroundCommand?: (toolUseId: string) => void;
  /** The tool uses whose background stop is in flight, by id. Only meaningful with `onStopBackgroundCommand`. */
  readonly stoppingBackgroundToolUseIds?: ReadonlySet<string>;
  /**
   * Each tool use's last failed background stop, keyed by its id, shown on
   * its row. Supply {@link useStopBackgroundCommand}'s `errorsByToolUseId`.
   */
  readonly stopBackgroundErrors?: ReadonlyMap<string, Error>;
  /**
   * Render each *settled* file review as a read-only record card at its
   * anchor in the thread (after the last row that edited one of its files)
   * — the durable history of what changed and how it was decided. This is
   * the only in-thread trace for changes made by shell commands, so the
   * surface that owns the session history should enable it.
   *
   * The thread never renders *decision* controls: a set still undecided on
   * a live turn is deliberately NOT emitted here — its decision surface is
   * the composer-docked {@link FileReviewDock}, which cannot scroll out of
   * view. The edit rows' badges carry the pending state in-thread.
   *
   * @default false
   */
  readonly showFileReviewRecords?: boolean;
  /**
   * The conversation's resources from the session spec. When provided,
   * file paths in tool call rendering become interactive: a path in a git
   * repository opens on GitHub, a path in a local folder offers
   * copy-to-clipboard.
   *
   * Passed to {@link FilePathContext} for consumption by
   * {@link FilePathLink} components deep in the tree.
   */
  readonly resources?: readonly SessionResource[];
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
   * Marks the agent version each turn ran
   * (`RunStatus.agent_version_hash`): a quiet divider before
   * the first turn that recorded one and wherever the version changes, so
   * every turn reads under the version it ran. Receives a version hash
   * and returns how it reads (a tag, else a short hash); the session view
   * passes `useSessionAgentVersion`'s `labelOf`. Omit for no markers.
   */
  readonly agentVersionLabel?: (versionHash: string) => string;
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
   * turn's {@link PlanCompletionCard}.
   *
   * When provided, a CTA card is rendered at the end of the thread
   * after a Plan-mode turn completes successfully. The consumer
   * typically wires this to switch the interaction mode to Agent,
   * pre-fill the composer, and focus it.
   *
   * When omitted, no plan completion card is rendered.
   */
  readonly onBuildFromPlan?: () => void;
  /**
   * Opens a plan in the session panel's plan document tab — the side-by-side
   * review/refine surface. Wired to EVERY plan card: the latest opens
   * editable/buildable, a superseded plan opens read-only (the host decides
   * from the run id). When omitted, cards fall back to the "Open full"
   * preview modal (hosts without a panel).
   *
   * Providing this also opts the thread into LIVE plan collapse: while a
   * Plan-mode turn writes its plan (detected via `findStreamingPlan`), the
   * plan message is suppressed behind a compact {@link PlanStreamingCard}
   * whose "Open plan" routes here — the host is expected to render the
   * streaming document in its plan surface. Hosts without one (this prop
   * omitted) keep the plan streaming inline, where it stays readable.
   */
  readonly onOpenPlan?: (executionId: string) => void;
  /**
   * Organization id (a slug is also accepted). Required for the plan completion card's
   * "Review plan" action, which opens the shared file preview
   * modal (the modal needs `org` for its detection/apply pipeline).
   */
  readonly org?: string;
  /**
   * Disables the plan completion card's actions (Implement / Review).
   * Defense in depth for the brief windows where a follow-up cannot be
   * sent (e.g. a turn is working); the composer also no-ops a
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
   * When omitted, content spans the full width.
   */
  readonly contentColumn?: ThreadContentColumn;
  /**
   * Component overrides for the thread's chrome — see
   * {@link MessageThreadSlots}. Omitted slots render the built-ins;
   * omitting the prop entirely changes nothing.
   */
  readonly slots?: MessageThreadSlots;
  /**
   * Show run scores: thumbs up and down on each completed turn's final
   * answer and the run-health flags beside them. The thread then reads the
   * session's scores once (and again shortly after a turn completes, while
   * it is graded). Off by default, and a thread with it off makes no score
   * request; `SessionViewer` sets it from its audience.
   *
   * @default false
   */
  readonly runScores?: boolean;
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
/** What a message sent while a turn worked says while no turn has read it. */
export const QUEUED_MESSAGE_LABEL = "Queued — read at the agent's next step";
/** What a queued message says once a stop ended the turn before it was read. */
export const DROPPED_MESSAGE_LABEL = "Not read — the turn was stopped";

export type ThreadItem =
  | { readonly kind: "queued-message"; readonly message: QueuedMessage; readonly key: string }
  | { readonly kind: "message"; readonly message: ThreadMessage; readonly key: string; readonly isPending?: boolean; readonly isFailed?: boolean; readonly isEditable?: boolean; readonly isPlanDocument?: boolean; readonly interactionMode?: InteractionMode; readonly files?: readonly MessageFileView[]; readonly executionId?: string; readonly scoresRunId?: string }
  | { readonly kind: "tool-group"; readonly toolUses: readonly ToolUse[]; readonly key: string }
  | { readonly kind: "subagent"; readonly toolUse: ToolUse; readonly thread: Thread; readonly key: string }
  | { readonly kind: "phase-badge"; readonly phase: RunPhase; readonly key: string }
  | { readonly kind: "execution-error"; readonly error: string; readonly retryMessage?: string; readonly key: string }
  | { readonly kind: "approval-request"; readonly toolUse: ToolUse; readonly key: string }
  | { readonly kind: "file-review-record"; readonly fileReviewSet: FileReviewSet; readonly key: string }
  | { readonly kind: "setup-progress"; readonly resources: readonly SessionResource[]; readonly serverPhase?: string; readonly isAwaitingResponse?: boolean; readonly key: string }
  | { readonly kind: "recalled-memories"; readonly recall: MemoryRecall; readonly facts: readonly RecalledMemoryFact[]; readonly key: string }
  | { readonly kind: "context-compacted"; readonly compacted: CompactedItem; readonly key: string }
  | { readonly kind: "agent-version"; readonly versionHash: string; readonly label: string; readonly key: string }
  | { readonly kind: "loaded-versions"; readonly changes: readonly LoadedVersionChange[]; readonly key: string }
  | {
      readonly kind: "todos";
      readonly key: string;
      readonly executionId: string;
      readonly todos: readonly Todo[];
    }
  | {
      readonly kind: "plan-completion";
      readonly key: string;
      readonly executionId: string;
      readonly planFile?: StigmerFile;
      /**
       * The plan's title (its leading `# H1`), lifted from the plan message at
       * build time — no fetch. Present only when the turn returned a plan
       * File (the collapsed-card path); the card falls back to "Plan".
       */
      readonly planTitle?: string;
      /**
       * True for the most recent completed Plan turn in the thread — the
       * only plan whose card carries the primary "Build" action. Superseded
       * plans keep their review actions (open/download) but never a build
       * CTA, so a stale plan can't be implemented by accident.
       */
      readonly isLatestPlan: boolean;
    }
  | {
      /**
       * A plan the live Plan-mode turn is writing RIGHT NOW: the plan
       * message is suppressed and this compact card stands in while the
       * document renders live in the panel's plan tab. On completion the
       * item becomes `plan-completion` — a different kind under the SAME
       * key, so the card holds one thread position and the swap reads as
       * the card settling.
       */
      readonly kind: "plan-writing";
      readonly key: string;
      readonly executionId: string;
      /** Live title (the plan's leading `# H1`), growing as it streams. */
      readonly planTitle?: string;
      /** Length of the plan text written so far (drives the live size). */
      readonly planSize: number;
    }
  | {
      /**
       * The ambient-liveness status line at the thread's tail (stigmer#277):
       * emitted while the live turn is running with no running tool call,
       * no live subagent, and no call waiting for a person — the quiet
       * stretches where the screen would otherwise be completely still.
       */
      readonly kind: "liveness";
      readonly key: string;
      /**
       * The background commands the turn is held for, oldest first, when the
       * agent's reply has ended and the turn waits only on them (the turn's
       * liveness shows no wait on its model); empty otherwise.
       */
      readonly waitingOn: ReadonlyArray<ToolUse>;
    };

/** Options for {@link buildThreadItems}: everything beyond the turns and their runs. */
export interface BuildThreadItemsOptions {
  /** The optimistic message shown before the session's events carry it. */
  readonly pendingUserMessage?: string | null;
  /** Emit a bottom approval card for a waiting tool use that has no row of its own. */
  readonly includeApprovals?: boolean;
  readonly resources?: readonly SessionResource[];
  readonly pendingMessageFailed?: boolean;
  /** Mark the live turn's message editable. */
  readonly editableActiveTurn?: boolean;
  readonly includeFileReviewRecords?: boolean;
  /** Suppress a plan being written behind a live plan card. */
  readonly collapseStreamingPlan?: boolean;
  readonly pendingFiles?: readonly MessageFileView[] | null;
  /** Messages that wait for the working turn, or that a stop dropped. */
  readonly queued?: readonly QueuedMessage[];
  readonly agentVersionLabel?: (versionHash: string) => string;
  /** Each Plan-mode turn's plan File, by run id. */
  readonly planFiles?: ReadonlyMap<string, StigmerFile>;
}

/** The phases a turn ends with a badge for: everything but a completion. */
const BADGED_END_PHASES: ReadonlySet<string> = new Set(["failed", "cancelled", "terminated"]);

/**
 * True once the agent has produced any real, renderable response in a turn —
 * a message with text, a thinking (live or with text), or a tool use.
 *
 * Gates the synthetic "Thinking…" setup placeholder: the placeholder is only
 * for the genuine pre-first-content window and must yield the moment any of
 * these appear, otherwise it would render *alongside* the real
 * ThinkingMessage / ToolCallGroup cards (the GitHub #179 duplicate-spinner).
 */
function hasStartedResponding(turn: Turn): boolean {
  return turn.items.some((item) => {
    switch (item.kind) {
      case "tool_use":
        return true;
      case "message":
        return item.text.trim().length > 0;
      case "thinking":
        return item.live || item.text.trim().length > 0;
      default:
        return false;
    }
  });
}

/**
 * True while the live turn already shows a live signal of its own somewhere
 * in the thread — a running tool call (its row's label carries the shimmer)
 * or a working subagent (its section carries a live indicator), at any
 * depth. Suppresses the bottom liveness line: one ambient signal at a time.
 */
function hasVisiblyRunningActivity(items: ReadonlyArray<TurnItem>): boolean {
  return items.some(
    (item) =>
      item.kind === "tool_use" &&
      (item.state === "running" ||
        (item.thread !== undefined &&
          (item.thread.state === "running" || hasVisiblyRunningActivity(item.thread.items)))),
  );
}

/** The background commands running now among `items`, at any depth, oldest first. */
function runningBackgroundCommands(items: ReadonlyArray<TurnItem>): ToolUse[] {
  const running = items.flatMap((item): ToolUse[] =>
    item.kind !== "tool_use"
      ? []
      : [...(isBackgroundRunning(item) ? [item] : []), ...(item.thread === undefined ? [] : runningBackgroundCommands(item.thread.items))],
  );
  return running.sort((a, b) => (a.background?.startedAt ?? "").localeCompare(b.background?.startedAt ?? ""));
}

/**
 * True for a turn that ran in Plan mode and completed — the only kind of
 * turn that has a reviewable plan (a live, failed or stopped Plan turn has
 * nothing final to review or build from).
 */
function isCompletedPlanTurn(turn: Turn, run: Run | undefined): boolean {
  return (
    turn.status?.phase === "completed" &&
    run?.spec?.interactionMode === InteractionMode.PLAN
  );
}

/**
 * The id of the message that IS a turn's plan, or of its final answer: the
 * last agent message with content — the SAME selection rule the runner uses
 * to write the plan File, so the message promoted to a document in the
 * thread is byte-identical to the plan File.
 * `undefined` when the turn wrote none.
 */
function lastMessageId(items: ReadonlyArray<TurnItem>): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "message" && item.text.trim().length > 0) return item.id;
  }
  return undefined;
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
 * Adds the ids of the tool uses a subagent renders as nested rows (its
 * non-internal calls, at any depth) to `target`, so their asks are treated
 * as inline and skip the bottom backstop.
 */
function collectThreadToolUseIds(thread: Thread, target: Set<string>): void {
  for (const item of thread.items) {
    if (item.kind !== "tool_use" || isInternalTool(item.name)) continue;
    target.add(item.id);
    if (item.thread) collectThreadToolUseIds(item.thread, target);
  }
}

/**
 * Records, for each of a turn's file reviews, the index of the just-pushed
 * tool-group item when one of its rows edited a file of the review — later
 * groups overwrite, so the map converges on each set's LAST editing row. That
 * index is where the set's record anchors: the record appears where the
 * turn's editing activity ended, not at the thread tail.
 */
function recordFileReviewAnchors(
  toolUses: readonly ToolUse[],
  itemIndex: number,
  sets: readonly FileReviewSet[],
  anchorIndexBySetId: Map<string, number>,
): void {
  if (sets.length === 0) return;
  for (const toolUse of toolUses) {
    const category = resolveToolCategoryFromCall(toolUse).category;
    if (category !== "write" && category !== "edit" && category !== "delete") continue;
    const path = extractPrimaryArg(toolUse);
    if (!path) continue;
    for (const set of sets) {
      if (fileForRowPath(set, path)) anchorIndexBySetId.set(set.changeSetId, itemIndex);
    }
  }
}

/**
 * Inserts one turn's settled file-review records into its own thread
 * segment: each set's read-only `file-review-record` item is spliced
 * immediately after the last row that edited one of its files
 * ({@link recordFileReviewAnchors}); a set no row edited (its changes were
 * made by shell commands) falls back to the segment's tail — this record is
 * that set's ONLY in-thread trace, so it is never dropped.
 *
 * A set still undecided on a live turn is deliberately NOT emitted: its
 * decision surface is the composer-docked `FileReviewDock`, which cannot
 * scroll out of view, and the edit rows' badges carry the pending state in
 * place. The same set re-enters here as a record once its turn ends.
 */
function insertFileReviewItems(
  items: ThreadItem[],
  sets: readonly FileReviewSet[],
  anchorIndexBySetId: ReadonlyMap<string, number>,
  turnEnded: boolean,
): void {
  const anchored: { index: number; item: ThreadItem }[] = [];
  const tail: ThreadItem[] = [];
  for (const set of sets) {
    if (set.files.length === 0) continue;
    if (!turnEnded && set.undecided) continue;
    const item: ThreadItem = {
      kind: "file-review-record",
      fileReviewSet: set,
      key: `file-review-${set.changeSetId}`,
    };
    const index = anchorIndexBySetId.get(set.changeSetId);
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
 * Builds a flat list of renderable thread items from a session's folded
 * turns and their runs.
 *
 * Keys use the events' own ids (each message, tool use and thread), so React
 * reconciles items across renders without remounts as the fold grows.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function buildThreadItems(
  turns: readonly Turn[],
  runs: readonly Run[],
  options: BuildThreadItemsOptions = {},
): ThreadItem[] {
  const {
    pendingUserMessage,
    includeApprovals = false,
    resources,
    pendingMessageFailed = false,
    editableActiveTurn = false,
    includeFileReviewRecords = false,
    collapseStreamingPlan = false,
    pendingFiles,
    queued = [],
    agentVersionLabel,
    planFiles,
  } = options;
  const runsById = new Map<string, Run>();
  for (const run of runs) {
    const id = run.metadata?.id;
    if (id) runsById.set(id, run);
  }

  const items: ThreadItem[] = [];
  // The version the previous turn ran, so a marker appears only where the
  // version a turn ran starts or changes.
  let lastAgentVersionHash = "";
  // What the last turn that recorded a list loaded, so a marker appears only
  // where a skill or plugin it loaded moved to another version.
  let lastLoaded: ReadonlyMap<string, LoadedVersionChange> | undefined;
  // Tool-use ids that render as an inline-decision-capable ToolCallItem (a
  // row of the turn, or a subagent's nested row). Their asks show inline on
  // the row, so they are excluded from the bottom backstop below.
  const inlineToolUseIds = new Set<string>();

  // A reconcile turn (the message-less turn an Undo starts to put files
  // back) is not a turn of the conversation and renders nothing.
  const shown = turns.filter((turn) => runsById.get(turn.runId)?.spec?.reconcileFileReview !== true);
  const lastTurn = shown.at(-1);
  const activeTurn = lastTurn !== undefined && !lastTurn.ended ? lastTurn : undefined;

  // The most recent completed Plan turn owns the primary "Build" action;
  // every earlier plan renders as a review-only record.
  let latestPlanRunId: string | null = null;
  for (let i = shown.length - 1; i >= 0; i--) {
    const turn = shown[i]!;
    if (isCompletedPlanTurn(turn, runsById.get(turn.runId))) {
      latestPlanRunId = turn.runId;
      break;
    }
  }

  for (const turn of shown) {
    const run = runsById.get(turn.runId);
    const runId = turn.runId;
    const isActiveTurn = turn === activeTurn;

    // A completed Plan turn collapses its plan message into the compact plan
    // card (the plan-completion item): the document lives in the panel's plan
    // tab, not the thread. While the plan is being written, the same
    // treatment applies live when the host has a plan surface (streamingPlan
    // below). Collapse of a COMPLETED plan is gated on the plan FILE existing:
    // a plan with no File exists only in the message, so that path
    // keeps the inline document promotion (isPlanDocument) — collapsing it
    // would orphan the plan behind a card with nothing to open.
    const isCompletedPlan = isCompletedPlanTurn(turn, run);
    const planMessageId = isCompletedPlan ? lastMessageId(turn.items) : undefined;
    const planFile = isCompletedPlan ? planFiles?.get(runId) : undefined;
    const collapsePlanMessage = planMessageId !== undefined && planFile !== undefined;

    // A completed turn's final answer carries its scores (thumbs and the
    // run-health flags): the last agent message with content, unless it is
    // the turn's plan, which renders as a document or a card instead.
    const scoredMessageId =
      turn.status?.phase === "completed" && planMessageId === undefined
        ? lastMessageId(turn.items)
        : undefined;

    // The plan the live Plan-mode turn is writing RIGHT NOW (the H1
    // convention — see findStreamingPlan). Two gates: the host wired a plan
    // surface (collapseStreamingPlan) and this is the live turn.
    const streamingPlan =
      collapseStreamingPlan && isActiveTurn ? findStreamingPlan(turn, run) : undefined;

    const fileReviewAnchors = new Map<string, number>();
    const reviewSets = includeFileReviewRecords ? turn.fileReview : [];

    // The agent's plan renders as one inline card per turn, anchored to the
    // first of: the opening message or thinking, the first unit of work, or
    // — as a backstop — the turn's tail.
    let todosEmitted = false;
    function emitTodos(): void {
      if (todosEmitted || turn.todos.length === 0) return;
      todosEmitted = true;
      items.push({
        kind: "todos",
        executionId: runId,
        todos: turn.todos,
        key: `${runId}-todos`,
      });
    }

    // The agent version this turn ran opens its segment when it differs
    // from the previous turn's. A turn that recorded none (the built-in
    // assistant) leaves the last marker standing.
    const turnVersionHash = run?.status?.agentVersionHash ?? "";
    if (
      agentVersionLabel !== undefined &&
      turnVersionHash !== "" &&
      turnVersionHash !== lastAgentVersionHash
    ) {
      lastAgentVersionHash = turnVersionHash;
      items.push({
        kind: "agent-version",
        versionHash: turnVersionHash,
        label: agentVersionLabel(turnVersionHash),
        key: `${runId}-agent-version`,
      });
    }

    // A skill or plugin this turn loaded at another version than the turn
    // before it opens the segment too.
    const turnLoaded = run ? lastLoadedVersions(run) : undefined;
    if (turnLoaded !== undefined) {
      const previous = lastLoaded;
      const changes =
        previous === undefined
          ? []
          : [...turnLoaded.entries()].flatMap(([resource, entry]) => {
              const before = previous.get(resource);
              return before !== undefined && before.version !== entry.version ? [entry] : [];
            });
      if (changes.length > 0) {
        items.push({ kind: "loaded-versions", changes, key: `${runId}-loaded-versions` });
      }
      lastLoaded = turnLoaded;
    }

    // The person's message. With the run at hand the shared conversation
    // rule decides what shows (see syntheticUserPrompt in @stigmer/client:
    // the empty prompt, the "execute" placeholder and a Build-from-plan
    // turn's label are skipped); before the run is listed, the message
    // the session's events carry.
    const promptText = run ? syntheticUserPrompt(run) : (turn.userMessage?.text ?? "");
    if (promptText) {
      // When the live turn's message matches the pending one, a shared
      // bridging key lets React update the pending bubble in place.
      const bridgePending =
        isActiveTurn && pendingUserMessage != null && promptText === pendingUserMessage;
      // The files the server recorded for the turn's message.
      const messageFiles = messageFileViews(run?.status?.messageFiles ?? []);
      items.push({
        kind: "message",
        message: { kind: "user", id: turn.userMessage?.id ?? `${runId}.user`, text: promptText },
        key: bridgePending ? "pending-user-turn" : `${runId}-spec`,
        // The live turn's message is the one a person can edit and resubmit
        // (stop + rephrase), when the consumer enabled editing.
        isEditable: isActiveTurn && editableActiveTurn,
        // The turn's mode marks the bubble (a "Plan" pill on Plan turns).
        interactionMode: run?.spec?.interactionMode,
        files: messageFiles.length > 0 ? messageFiles : undefined,
        executionId: runId,
      });
    }

    // The retriever transparency card: this turn ran semantic selection over
    // its memory snapshot, so its segment discloses the subset right after
    // the person's message. A recall without selection (wholesale) renders
    // nothing.
    if (turn.memory?.selectionActive) {
      items.push({
        kind: "recalled-memories",
        recall: turn.memory,
        facts: run?.status?.recalledMemories?.facts ?? [],
        key: `${runId}-recalled-memories`,
      });
    }

    // The turn's consecutive tool uses, waiting to be flushed as rows: one
    // group per run of calls between messages, a subagent in its own card.
    let group: ToolUse[] = [];
    const flushGroup = (): void => {
      if (group.length === 0) return;
      // Anchor (2): if work begins before any rendered narration, the plan
      // still leads it.
      emitTodos();
      items.push({ kind: "tool-group", toolUses: group, key: `${group[0]!.id}-tc` });
      recordFileReviewAnchors(group, items.length - 1, reviewSets, fileReviewAnchors);
      for (const toolUse of group) inlineToolUseIds.add(toolUse.id);
      group = [];
    };

    for (const item of turn.items) {
      switch (item.kind) {
        case "tool_use":
          // A to-do call renders through the to-dos card, never as a row.
          if (isInternalTool(item.name)) break;
          if (item.thread !== undefined) {
            flushGroup();
            emitTodos();
            items.push({ kind: "subagent", toolUse: item, thread: item.thread, key: `sa-${item.id}` });
            collectThreadToolUseIds(item.thread, inlineToolUseIds);
          } else {
            group.push(item);
          }
          break;
        case "message": {
          flushGroup();
          if (item.text.trim().length === 0) break;
          // The collapsed plan message is not rendered — the plan card at the
          // segment's end is the turn's sole plan representation. A plan
          // being written is suppressed the same way behind its live card.
          const suppressAsPlan =
            (collapsePlanMessage && item.id === planMessageId) ||
            item.id === streamingPlan?.messageId;
          if (!suppressAsPlan) {
            items.push({
              kind: "message",
              message: item,
              key: item.id,
              isPlanDocument: !collapsePlanMessage && item.id === planMessageId,
              ...(item.id === scoredMessageId ? { scoresRunId: runId } : {}),
            });
          }
          // Anchor (1): the plan sits right under the agent's opening narration.
          emitTodos();
          break;
        }
        case "thinking":
          flushGroup();
          items.push({ kind: "message", message: item, key: item.id });
          emitTodos();
          break;
        case "note":
          flushGroup();
          items.push({ kind: "message", message: item, key: item.id });
          break;
        case "compacted":
          flushGroup();
          items.push({ kind: "context-compacted", compacted: item, key: item.id });
          break;
        case "user_message":
          // A message the person sent while the turn worked, where the
          // turn read it.
          flushGroup();
          items.push({ kind: "message", message: { kind: "user", id: item.id, text: item.text }, key: item.id });
          break;
      }
    }
    flushGroup();

    // A completed Plan turn closes its segment with the plan card. Every
    // plan stays reviewable; only the latest carries the build authority. A
    // superseded plan that returned no File is skipped — with no File and
    // no build CTA it would render an empty shell.
    if (isCompletedPlan) {
      const isLatestPlan = runId === latestPlanRunId;
      if (planFile || isLatestPlan) {
        const planMessage = turn.items.find((item) => item.id === planMessageId);
        items.push({
          kind: "plan-completion",
          key: `${runId}-plan-completion`,
          executionId: runId,
          planFile,
          planTitle:
            collapsePlanMessage && planMessage?.kind === "message"
              ? extractPlanTitle(planMessage.text)
              : undefined,
          isLatestPlan,
        });
      }
    } else if (streamingPlan) {
      // The live stand-in for the suppressed plan message. It SHARES the
      // completion item's key: on completion this item becomes the
      // plan-completion item above (a kind change under a stable key).
      items.push({
        kind: "plan-writing",
        key: `${runId}-plan-completion`,
        executionId: runId,
        planTitle: extractLeadingH1(streamingPlan.displayText).title ?? undefined,
        planSize: streamingPlan.displayText.length,
      });
    }

    // Anchor (3): a plan that produced no rendered narration or work item
    // still surfaces — never silently dropped.
    emitTodos();

    // Settled records land inside this turn's segment, at their anchors.
    if (reviewSets.length > 0) {
      insertFileReviewItems(items, reviewSets, fileReviewAnchors, turn.ended);
    }
  }

  const lastRun = lastTurn ? runsById.get(lastTurn.runId) : undefined;
  const lastPhase = lastTurn?.status?.phase;

  if (activeTurn && !hasStartedResponding(activeTurn)) {
    const phase = activeTurn.status?.phase;
    if (phase === undefined || phase === "pending") {
      items.push({
        kind: "setup-progress",
        resources: resources ?? [],
        serverPhase: lastRun?.status?.setupProgress?.currentPhase || undefined,
        key: "setup-progress",
      });
    } else if (phase === "running") {
      items.push({
        kind: "setup-progress",
        resources: resources ?? [],
        isAwaitingResponse: true,
        key: "setup-progress",
      });
    }
  }

  if (lastTurn?.ended && lastPhase !== undefined && BADGED_END_PHASES.has(lastPhase)) {
    items.push({
      kind: "phase-badge",
      phase: runPhaseOf(lastPhase),
      key: `phase-${lastPhase}`,
    });

    // A failed or terminated turn carries its reason; surface it beside the
    // badge so a failure that produced no messages still explains itself.
    // A cancelled turn is a quiet end, not a failure (stigmer#282): the
    // phase, not the error field, decides whether the loud notice renders.
    const reason = lastTurn.status?.error;
    if (reason && lastPhase !== "cancelled") {
      const specMessage = lastRun?.spec?.message;
      // A failed build turn offers no inline Retry: resending its label as an
      // ordinary message would drop the buildFromPlan flag. The plan card
      // above the error is the fully-wired retry.
      const isBuildTurn = lastRun?.spec?.buildFromPlan === true;
      items.push({
        kind: "execution-error",
        error: reason,
        retryMessage:
          specMessage && specMessage !== "execute" && !isBuildTurn ? specMessage : undefined,
        key: `execution-error-${lastTurn.runId}`,
      });
    }
  }

  if (includeApprovals && lastTurn) {
    // Backstop only: a waiting tool use with a row shows its decision on that
    // row (see ApprovalContext / ToolCallItem). A bottom card is emitted ONLY
    // for one with no inline home, so a waiting call is never invisible, and
    // never duplicated.
    for (const ask of lastTurn.asks) {
      if (inlineToolUseIds.has(ask.id)) continue;
      items.push({ kind: "approval-request", toolUse: ask, key: `approval-${ask.id}` });
    }
  }

  // The ambient-liveness line (stigmer#277): the thread's tail is never a
  // dead frame while the agent works. Emitted only when the live turn is
  // running (waiting or paused means the agent is NOT working), past the
  // pre-first-content window, nothing else on screen carries its own live
  // signal, and no call waits for a person.
  if (
    activeTurn &&
    hasStartedResponding(activeTurn) &&
    activeTurn.status?.phase === "running" &&
    activeTurn.asks.length === 0 &&
    !hasVisiblyRunningActivity(activeTurn.items)
  ) {
    // Held for its background commands alone: the agent's reply has ended
    // (its liveness names no wait on the model) while commands still run.
    const waitingOn =
      activeTurn.liveness !== undefined && activeTurn.liveness.awaitingModelMs === undefined
        ? runningBackgroundCommands(activeTurn.items)
        : [];
    items.push({ kind: "liveness", key: "liveness-status", waitingOn });
  }

  // Messages sent while a turn worked that no turn has read, in the order
  // sent: waiting for the working turn, or dropped by a stop.
  for (const message of queued) {
    items.push({ kind: "queued-message", message, key: `queued-${message.id}` });
  }

  if (pendingUserMessage) {
    // A FAILED send never started a turn, so an existing turn with identical
    // text must never swallow the failed bubble. Suppression applies only to
    // the succeeded-send window where the turn appeared but the pending
    // state has not cleared yet.
    const alreadySynthesized =
      !pendingMessageFailed &&
      (lastTurn?.userMessage?.text === pendingUserMessage ||
        queued.some((message) => message.text === pendingUserMessage));
    if (!alreadySynthesized) {
      items.push({
        kind: "message",
        message: { kind: "user", id: "pending-user-turn", text: pendingUserMessage },
        key: "pending-user-turn",
        // A failed turn shows the inline error instead of the dimmed
        // sending state — the two are mutually exclusive.
        isPending: !pendingMessageFailed,
        isFailed: pendingMessageFailed,
        // The files sent with the message: evidence they rode with the turn,
        // kept on failure so Retry shows what will be re-sent.
        files:
          pendingFiles && pendingFiles.length > 0
            ? pendingFiles
            : undefined,
      });
    }
  }

  return items;
}

/**
 * Each turn's file reviews from the fold, keyed by run id, and the runs'
 * captured change sets keyed by id: what the file-edit rows badge and the
 * write rows' diffs read (see {@link FileReviewContext}).
 */
function fileReviewContextOf(turns: readonly Turn[], runs: readonly Run[]): FileReviewContextValue {
  const fileReviewByRunId = new Map<string, readonly FileReviewSet[]>();
  for (const turn of turns) {
    if (turn.fileReview.length > 0) fileReviewByRunId.set(turn.runId, turn.fileReview);
  }
  const changeSetsById = new Map<string, FileChangeSet>();
  for (const run of runs) {
    for (const changeSet of displayFileChangeSets(run.status)) {
      changeSetsById.set(changeSet.id, changeSet);
    }
  }
  return { fileReviewByRunId, changeSetsById };
}

/**
 * Renders a conversation from its session's folded turns: each turn's
 * person's message, the agent's messages, thinking and tool calls in the
 * order it produced them, its subagents, to-dos, plan, file reviews and
 * how it ended.
 *
 * Composes {@link MessageEntry}, {@link ToolCallGroup}, and
 * {@link RunPhaseBadge} into a scrollable, auto-scrolling log
 * that follows new content when the user is near the bottom.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 *
 * <MessageThread
 *   turns={conv.turns}
 *   runs={conv.runs}
 *   onAnswerToolUse={conv.answerToolUse}
 * />
 * ```
 */
export function MessageThread({
  turns,
  runs = EMPTY_RUNS,
  planFiles,
  pendingUserMessage,
  pendingFiles,
  queued,
  pendingMessageFailed = false,
  onRetrySend,
  scrollOnSend = true,
  onRetryRun,
  onEditMessage,
  className,
  formatToolCallSummary,
  onAnswerToolUse,
  answeringToolUseIds,
  answerErrors,
  onStopBackgroundCommand,
  stoppingBackgroundToolUseIds,
  stopBackgroundErrors,
  showFileReviewRecords = false,
  resources,
  onFilePathClick,
  sandboxWorkspaceRoot,
  agentVersionLabel,
  virtualized = false,
  onBuildFromPlan,
  onOpenPlan,
  org,
  planActionsDisabled,
  planBuildPending,
  contentColumn,
  slots,
  runScores = false,
}: MessageThreadProps) {
  useRenderTracer("MessageThread", { turns, runs });

  const includeApprovals = onAnswerToolUse != null;
  const editableActiveTurn = onEditMessage != null;
  // A plan being written is collapsed behind its live card only when the host
  // can open the plan document surface — a panel-less host (no onOpenPlan)
  // keeps the plan streaming inline, where it remains readable.
  const collapseStreamingPlan = onOpenPlan != null;
  const items = useMemo(
    () =>
      buildThreadItems(turns, runs, {
        pendingUserMessage,
        includeApprovals,
        resources,
        pendingMessageFailed,
        editableActiveTurn,
        includeFileReviewRecords: showFileReviewRecords,
        collapseStreamingPlan,
        pendingFiles,
        queued,
        agentVersionLabel,
        planFiles,
      }),
    [turns, runs, pendingUserMessage, includeApprovals, resources, pendingMessageFailed, editableActiveTurn, showFileReviewRecords, collapseStreamingPlan, pendingFiles, queued, agentVersionLabel, planFiles],
  );

  useKeyStability(items);

  // Scroll-on-send: the send moment is the optimistic
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
      resources: resources ?? [],
      onFilePathClick,
    }),
    [resources, onFilePathClick],
  );

  const sandboxCtx = useMemo<SandboxContextValue>(
    () => ({ sandboxWorkspaceRoot: sandboxWorkspaceRoot ?? "" }),
    [sandboxWorkspaceRoot],
  );

  // The answer handler and its per-gate state, for the rows that wait (a
  // row knows it waits from its own tool use; see ApprovalContext).
  // buildThreadItems still emits a bottom card for a waiting call with no
  // row of its own (the backstop).
  const approvalCtx = useMemo<ApprovalContextValue>(
    () => ({
      onAnswer: onAnswerToolUse,
      submittingIds: answeringToolUseIds ?? EMPTY_SUBMITTING_IDS,
      errorsByToolUseId: answerErrors ?? EMPTY_ANSWER_ERRORS,
    }),
    [onAnswerToolUse, answeringToolUseIds, answerErrors],
  );

  // The stop of a command the agent runs in the background, for its row and
  // the tail line (see BackgroundCommandContext).
  const backgroundCtx = useMemo<BackgroundCommandContextValue>(
    () => ({
      onStop: onStopBackgroundCommand,
      stoppingIds: stoppingBackgroundToolUseIds ?? EMPTY_SUBMITTING_IDS,
      errorsByToolUseId: stopBackgroundErrors ?? EMPTY_ANSWER_ERRORS,
    }),
    [onStopBackgroundCommand, stoppingBackgroundToolUseIds, stopBackgroundErrors],
  );

  // Each turn's file reviews and the runs' captured bytes, so a file-edit row
  // badges its file's live review state and a write row renders its diff
  // wherever it renders (parent thread or nested groups). Rebuilt only when
  // the turns or runs change.
  const fileReviewCtx = useMemo<FileReviewContextValue>(
    () => fileReviewContextOf(turns, runs),
    [turns, runs],
  );

  // Drives the global "approval needed" peek affordance — a count, not the
  // cards, so the bar reuses the existing scroll machine without a new observer.
  const unresolvedApprovalCount = includeApprovals ? (turns.at(-1)?.asks.length ?? 0) : 0;

  const withRunScores = (thread: ReactNode): ReactNode => (
    <BackgroundCommandContext.Provider value={backgroundCtx}>
      {runScores ? <RunScoresProvider runs={runs}>{thread}</RunScoresProvider> : thread}
    </BackgroundCommandContext.Provider>
  );

  if (virtualized) {
    return withRunScores(
      <div className={cn("stg:relative stg:min-h-0", className)}>
        <Suspense fallback={null}>
          <LazyVirtualizedThread
            items={items}
            formatToolCallSummary={formatToolCallSummary}
            onAnswerToolUse={onAnswerToolUse}
            answeringToolUseIds={answeringToolUseIds}
            answerErrors={answerErrors}
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
            onRetryRun={onRetryRun}
            onEditMessage={onEditMessage}
            slots={slots}
            pinToLatestSignal={pinToLatestSignal}
          />
        </Suspense>
      </div>,
    );
  }

  return withRunScores(
    <NonVirtualizedThread
      items={items}
      className={className}
      contentColumn={contentColumn}
      formatToolCallSummary={formatToolCallSummary}
      onAnswerToolUse={onAnswerToolUse}
      answeringToolUseIds={answeringToolUseIds}
      answerErrors={answerErrors}
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
      onRetryRun={onRetryRun}
      onEditMessage={onEditMessage}
      slots={slots}
      pinToLatestSignal={pinToLatestSignal}
    />,
  );
}

// ---------------------------------------------------------------------------
// NonVirtualizedThread — original scroll-container rendering path
// ---------------------------------------------------------------------------

interface NonVirtualizedThreadProps {
  readonly items: readonly ThreadItem[];
  readonly className?: string;
  readonly contentColumn?: ThreadContentColumn;
  readonly formatToolCallSummary?: (toolUses: readonly ToolUse[]) => string;
  readonly onAnswerToolUse?: (toolUseId: string, answer: ToolUseAnswer, denyMessage?: string) => void;
  readonly answeringToolUseIds?: ReadonlySet<string>;
  readonly answerErrors?: ReadonlyMap<string, Error>;
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
  readonly onRetryRun?: (message: string) => void;
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
  onAnswerToolUse,
  answeringToolUseIds,
  answerErrors,
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
  onRetryRun,
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
                  onAnswerToolUse={onAnswerToolUse}
                  answeringToolUseIds={answeringToolUseIds}
                  answerErrors={answerErrors}
                  onBuildFromPlan={onBuildFromPlan}
                  onOpenPlan={onOpenPlan}
                  org={org}
                  planActionsDisabled={planActionsDisabled}
                  planBuildPending={planBuildPending}
                  onRetrySend={onRetrySend}
                  onRetryRun={onRetryRun}
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
  readonly formatToolCallSummary?: (toolUses: readonly ToolUse[]) => string;
  readonly onAnswerToolUse?: (toolUseId: string, answer: ToolUseAnswer, denyMessage?: string) => void;
  readonly answeringToolUseIds?: ReadonlySet<string>;
  readonly answerErrors?: ReadonlyMap<string, Error>;
  readonly onBuildFromPlan?: () => void;
  readonly onOpenPlan?: (executionId: string) => void;
  readonly org?: string;
  readonly planActionsDisabled?: boolean;
  /** True while the approved plan is being uploaded ahead of the build turn. */
  readonly planBuildPending?: boolean;
  readonly onRetrySend?: () => void;
  readonly onRetryRun?: (message: string) => void;
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
 * (`ApprovalCardRow`, `FileReviewRecordRow`) keep their callback
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
  onAnswerToolUse,
  answeringToolUseIds,
  answerErrors,
  onBuildFromPlan,
  onOpenPlan,
  org,
  planActionsDisabled,
  planBuildPending,
  onRetrySend,
  onRetryRun,
  onEditMessage,
  slots,
}: ThreadItemRendererProps) {
  const runScoresEnabled = useRunScoresEnabled();
  switch (item.kind) {
    case "message": {
      const Entry = slots?.MessageEntry ?? MessageEntry;
      if (item.isFailed) {
        return (
          <FailedUserMessage
            message={item.message}
            files={item.files}
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
          files={item.files}
          runId={item.executionId}
          onEdit={
            item.isEditable && onEditMessage
              ? () => onEditMessage(item.message.text)
              : undefined
          }
          actions={
            runScoresEnabled && item.scoresRunId !== undefined ? (
              <RunScores runId={item.scoresRunId} />
            ) : undefined
          }
        />
      );
    }
    case "tool-group":
      return (
        <ToolCallGroup
          toolUses={item.toolUses}
          formatSummary={formatToolCallSummary}
          className="stg:mx-4"
        />
      );
    case "subagent":
      return (
        <SubagentSection
          thread={item.thread}
          subject={subagentSubjectOf(item.toolUse)}
          startedAt={item.toolUse.processedAt}
          completedAt={item.toolUse.result?.processedAt}
          className="stg:mx-4"
        />
      );
    case "phase-badge":
      return (
        <div className="stg:flex stg:justify-center stg:py-3">
          <RunPhaseBadge phase={item.phase} />
        </div>
      );
    case "execution-error": {
      const ErrorNotice = slots?.RunErrorNotice ?? RunErrorNotice;
      return (
        <ErrorNotice
          error={item.error}
          retryMessage={item.retryMessage}
          onRetry={onRetryRun}
        />
      );
    }
    case "approval-request":
      return (
        <ApprovalCardRow
          toolUse={item.toolUse}
          onAnswerToolUse={onAnswerToolUse!}
          isSubmitting={answeringToolUseIds?.has(item.toolUse.id) ?? false}
          error={answerErrors?.get(item.toolUse.id) ?? null}
          ApprovalCardComponent={slots?.ApprovalCard ?? ApprovalCard}
        />
      );
    case "file-review-record":
      return <FileReviewRecordRow fileReviewSet={item.fileReviewSet} />;
    case "setup-progress": {
      const Setup = slots?.SetupProgress ?? SetupProgress;
      return (
        <Setup
          resources={item.resources}
          serverPhase={item.serverPhase}
          isAwaitingResponse={item.isAwaitingResponse}
        />
      );
    }
    case "recalled-memories": {
      const Recalled = slots?.RecalledMemoriesCard ?? RecalledMemoriesCard;
      return <Recalled recall={item.recall} facts={item.facts} />;
    }
    case "context-compacted":
      return <SummarizationCard compacted={item.compacted} />;
    case "agent-version":
      return <AgentVersionMarker label={item.label} />;
    case "loaded-versions":
      return <LoadedVersionsMarker changes={item.changes} />;
    case "liveness": {
      const Liveness = slots?.LivenessStatusLine ?? LivenessStatusLine;
      return item.waitingOn.length > 0 ? <Liveness waitingOn={item.waitingOn} /> : <Liveness />;
    }
    case "queued-message": {
      const Entry = slots?.MessageEntry ?? MessageEntry;
      return (
        <div className="stg:opacity-60">
          <Entry message={{ kind: "user", id: item.message.id, text: item.message.text }} />
          <p className="stg:px-4 stg:text-right stg:text-xs stg:text-muted-foreground">
            {item.message.state === "waiting" ? QUEUED_MESSAGE_LABEL : DROPPED_MESSAGE_LABEL}
          </p>
        </div>
      );
    }
    case "todos": {
      const Todos = slots?.TodoCard ?? TodoCard;
      return <Todos todos={item.todos} className="stg:mx-4" TodoRow={slots?.TodoRow} />;
    }
    case "plan-completion": {
      // When the turn returned its plan as a File, show the richer reviewable
      // card (preview / copy / download / implement). Otherwise fall back to the
      // bare Implement CTA (a plan the turn could not save).
      // Only the latest plan receives the build action — a superseded plan's
      // card is review-only, so a stale plan can never be implemented from it.
      const PlanCard = slots?.PlanFileCard ?? PlanFileCard;
      const Completion = slots?.PlanCompletionCard ?? PlanCompletionCard;
      return item.planFile && item.executionId ? (
        <PlanCard
          file={item.planFile}
          title={item.planTitle}
          org={org}
          onImplement={item.isLatestPlan ? onBuildFromPlan : undefined}
          // Every card routes to the plan document tab — the host renders a
          // superseded plan read-only there (it receives the run id).
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
// AgentVersionMarker — the agent version the following turns ran
// ---------------------------------------------------------------------------

/**
 * A quiet centered divider naming the agent version the turns below it
 * ran; the agent's Versions tab holds the full hash and the version's
 * message.
 */
function AgentVersionMarker({ label }: { readonly label: string }) {
  return (
    <div
      className="stg:flex stg:items-center stg:gap-3 stg:px-4 stg:py-2 stg:text-xs stg:text-muted-foreground"
      data-testid="agent-version-marker"
    >
      <span aria-hidden="true" className="stg:h-px stg:flex-1 stg:bg-border" />
      <span>Agent version {label}</span>
      <span aria-hidden="true" className="stg:h-px stg:flex-1 stg:bg-border" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoadedVersionsMarker — the skills and plugins that moved under a turn
// ---------------------------------------------------------------------------

/**
 * One skill or plugin a turn loaded (`RunStatus.loaded_versions`): its
 * kind, its id, the slug the server filled (empty once it was deleted) and
 * the version that ran.
 *
 * @internal Exported as part of {@link ThreadItem} — not part of the public
 * API.
 */
export interface LoadedVersionChange {
  readonly kind: ApiResourceKind;
  readonly id: string;
  readonly slug: string;
  readonly version: string;
}

/**
 * The version a run last loaded of each skill and plugin, keyed by kind and
 * id: a run resumed after a push holds both versions, and the later one is
 * what its last attempt ran. Undefined for a run that recorded none.
 */
function lastLoadedVersions(run: Run): ReadonlyMap<string, LoadedVersionChange> | undefined {
  const loaded = run.status?.loadedVersions;
  if (loaded === undefined || (loaded.skills.length === 0 && loaded.plugins.length === 0)) return undefined;
  const byResource = new Map<string, LoadedVersionChange>();
  const lists = [
    [ApiResourceKind.skill, loaded.skills],
    [ApiResourceKind.plugin, loaded.plugins],
  ] as const;
  for (const [kind, refs] of lists) {
    for (const ref of refs) {
      byResource.set(`${kind}/${ref.id}`, { kind, id: ref.id, slug: ref.slug, version: ref.version });
    }
  }
  return byResource;
}

/** How one moved resource reads: "Skill variance-report updated", or "A deleted skill was updated" once it is gone. */
function loadedVersionChangeText(change: LoadedVersionChange): string {
  if (isDeletedReference(change)) {
    return `A ${deletedReferenceLabel(change.kind)} was updated`;
  }
  return `${change.kind === ApiResourceKind.skill ? "Skill" : "Plugin"} ${change.slug} updated`;
}

/**
 * A quiet centered divider naming each skill and plugin the turns below it
 * ran at a newer version than the turn before, in the agent version
 * marker's form. Needs no consumer wiring: the server fills each name.
 */
function LoadedVersionsMarker({ changes }: { readonly changes: readonly LoadedVersionChange[] }) {
  return (
    <div
      className="stg:flex stg:items-center stg:gap-3 stg:px-4 stg:py-2 stg:text-xs stg:text-muted-foreground"
      data-testid="loaded-versions-marker"
    >
      <span aria-hidden="true" className="stg:h-px stg:flex-1 stg:bg-border" />
      <span>{changes.map(loadedVersionChangeText).join(" · ")}</span>
      <span aria-hidden="true" className="stg:h-px stg:flex-1 stg:bg-border" />
    </div>
  );
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
  files,
  onRetry,
  MessageEntryComponent,
}: {
  message: ThreadMessage;
  files?: readonly MessageFileView[];
  onRetry?: () => void;
  MessageEntryComponent: ComponentType<MessageEntryProps>;
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-1">
      {/* The files stay visible on the failed bubble — the one turn where
          the user most needs evidence of what they tried to send (and what
          Retry will re-send). No executionId: the send never created one. */}
      <MessageEntryComponent message={message} files={files} />
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
// ApprovalCardRow — stabilizes the onAnswer callback for React.memo
// ---------------------------------------------------------------------------

interface ApprovalCardRowProps {
  readonly toolUse: ToolUse;
  readonly onAnswerToolUse: (toolUseId: string, answer: ToolUseAnswer, denyMessage?: string) => void;
  readonly isSubmitting: boolean;
  // This gate's last failed answer, or null — a stable ref from the
  // answerErrors map, so the row re-renders only when its error appears/clears.
  readonly error?: Error | null;
  // The (possibly slotted) card component. The row's callback stabilization
  // wraps whichever card renders, so a slot override keeps the memo behavior.
  readonly ApprovalCardComponent: ComponentType<ApprovalCardProps>;
}

const ApprovalCardRow = memo(function ApprovalCardRow({
  toolUse,
  onAnswerToolUse,
  isSubmitting,
  error = null,
  ApprovalCardComponent,
}: ApprovalCardRowProps) {
  const handleAnswer = useCallback(
    (answer: ToolUseAnswer, denyMessage?: string) => {
      onAnswerToolUse(toolUse.id, answer, denyMessage);
    },
    [onAnswerToolUse, toolUse.id],
  );

  return (
    <ApprovalCardComponent
      toolUse={toolUse}
      onAnswer={handleAnswer}
      isSubmitting={isSubmitting}
      error={error}
      className="stg:mx-4"
    />
  );
});

// ---------------------------------------------------------------------------
// FileReviewRecordRow — a settled file review's read-only in-thread record
// ---------------------------------------------------------------------------

/**
 * Renders a settled file review as a read-only record at its position in the
 * transcript — what changed and how it was decided ("2 kept · 1 discarded").
 * Never interactive: the pending decision surface is the composer-docked
 * `FileReviewDock`, not a thread item (see {@link insertFileReviewItems}).
 */
const FileReviewRecordRow = memo(function FileReviewRecordRow({
  fileReviewSet,
}: {
  readonly fileReviewSet: FileReviewSet;
}) {
  const { changeSetsById } = useContext(FileReviewContext);
  return (
    <FileReviewCard
      fileReviewSet={fileReviewSet}
      capture={changeSetsById.get(fileReviewSet.changeSetId) ?? null}
      interactive={false}
      // The thread's stamped edit rows already show every diff in place, so
      // the record renders its compact file-list body — the history never
      // duplicates the transcript's diffs.
      showDiffs={false}
      className="stg:mx-4"
    />
  );
});
