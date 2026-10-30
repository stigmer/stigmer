// The terminal conversation: a session's folded turns as a scrolling log —
// each turn's message, the agent's messages, tool groups and subagents in
// the order it produced them, its settled file reviews, how the last turn
// ended, its waiting tool uses as approval prompts, and the optimistic
// message just sent. Ended turns are written once through Ink's <Static>;
// the live turn re-renders in place. Off a live screen (`live` false), where
// Ink writes one frame at exit, the whole thread is that frame.
import React, { useMemo } from "react";
import { Box, Text, Static } from "ink";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  displayFileChangeSets,
  isTodoTool,
  syntheticUserPrompt,
  type FileReviewSet,
  type Thread,
  type ToolUse,
  type QueuedMessage,
  type Turn,
} from "@stigmer/client";
import {
  FileReviewContext,
  runPhaseOf,
  subagentSubjectOf,
  type FileReviewContextValue,
  type ThreadMessage,
  type ToolUseAnswer,
} from "@stigmer/react-core";
import { MessageEntry } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { SubagentBlock } from "./SubagentBlock.js";
import { RunProgress } from "./RunProgress.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { FileReviewRecord } from "./FileReviewRecord.js";

/** Props for {@link MessageThread}. */
export interface MessageThreadProps {
  /** The conversation's turns, in order: the session's events folded. */
  readonly turns: readonly Turn[];
  /**
   * The turns' runs, for what the run record holds: the message a turn was
   * started with (so a build turn's label or a placeholder is not shown) and
   * the captured bytes of its file changes. A turn whose run is absent
   * renders from its events alone.
   */
  readonly runs?: readonly Run[];
  /** Optimistic user message shown before the session's events carry it. */
  readonly pendingUserMessage?: string | null;
  /**
   * Messages sent while a turn worked that no turn has read yet, shown
   * dimmed after the thread: queued for the agent's next step, or not read
   * because a stop ended the turn.
   */
  readonly queued?: readonly QueuedMessage[];
  /**
   * Answers a tool use that waits for a person. The last turn's waiting tool
   * uses render as approval prompts when provided.
   */
  readonly onAnswerToolUse?: (toolUseId: string, answer: ToolUseAnswer, denyMessage?: string) => void;
  /** Tool-use ids whose answer is in flight. */
  readonly answeringToolUseIds?: ReadonlySet<string>;
  /** Whether tool call groups should be rendered in expanded mode. Toggled via Ctrl+O. */
  readonly expandToolCalls?: boolean;
  /**
   * Whether to render a read-only record for each settled file review (every
   * file decided, or its turn ended) — the terminal analogue of the web's
   * in-thread record. Off by default so bare consumers stay minimal;
   * `SessionView` opts in. A set still undecided on the live turn is never a
   * record here — its decision surface is the docked `FileReviewPrompt`.
   */
  readonly showFileReviewRecords?: boolean;
  /**
   * Whether a person can answer with the keyboard. When `false` (off a
   * terminal) every approval prompt renders inert: nothing reads keys, and
   * the host settles each ask another way (`SessionView`'s `approveDefault`).
   * Defaults to `true`.
   */
  readonly canAnswer?: boolean;
  /**
   * Whether the screen redraws in place. When `false` (a pipe, a CI log, where
   * Ink writes one final frame at exit) the whole thread renders in that frame,
   * in order, with no `<Static>` history: written beside the frame, history
   * would appear twice and above the view's header. Defaults to `true`.
   */
  readonly live?: boolean;
}

/** What a message sent while a turn worked says while no turn has read it. */
export const QUEUED_MESSAGE_LABEL = "Queued — read at the agent's next step";
/** What a queued message says once a stop ended the turn before it was read. */
export const DROPPED_MESSAGE_LABEL = "Not read — the turn was stopped";

type ThreadItem =
  | { readonly kind: "message"; readonly message: ThreadMessage; readonly key: string }
  | { readonly kind: "tool-group"; readonly toolUses: readonly ToolUse[]; readonly key: string }
  | { readonly kind: "subagent"; readonly toolUse: ToolUse; readonly thread: Thread; readonly key: string }
  | { readonly kind: "phase"; readonly phase: RunPhase; readonly key: string }
  | { readonly kind: "pending-message"; readonly content: string; readonly key: string }
  | { readonly kind: "queued-message"; readonly message: QueuedMessage; readonly key: string }
  | { readonly kind: "file-review-record"; readonly set: FileReviewSet; readonly key: string }
  | { readonly kind: "approval"; readonly toolUse: ToolUse; readonly key: string };

const EMPTY_RUNS: readonly Run[] = [];

/** The phases a turn ends with a badge for: everything but a completion. */
const BADGED_END_PHASES: ReadonlySet<string> = new Set(["failed", "cancelled", "terminated"]);

/**
 * Whether a folded turn is a turn of the conversation: not a reconcile turn
 * (the message-less run an Undo starts to put files back) — known by its run
 * when present, and by having no message and no items otherwise.
 */
function isConversationTurn(turn: Turn, run: Run | undefined): boolean {
  if (run?.spec?.reconcileFileReview === true) return false;
  return turn.userMessage !== undefined || turn.items.length > 0;
}

/**
 * Builds one turn's items: the person's message (the run's rule skips a
 * placeholder or a build turn's label), each agent message and note, each
 * run of consecutive tool uses as a group (to-do calls left out), each
 * subagent as a block — plus (when `includeFileReviewRecords`) a read-only
 * record at the turn's tail for each settled file review.
 */
function buildTurnSegment(
  turn: Turn,
  run: Run | undefined,
  includeFileReviewRecords: boolean,
): ThreadItem[] {
  const seg: ThreadItem[] = [];
  const runId = turn.runId;

  const prompt = run ? syntheticUserPrompt(run) : (turn.userMessage?.text ?? "");
  if (prompt) {
    seg.push({
      kind: "message",
      message: { kind: "user", id: turn.userMessage?.id ?? `${runId}.user`, text: prompt },
      key: `${runId}-spec`,
    });
  }

  let group: ToolUse[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    seg.push({ kind: "tool-group", toolUses: group, key: `${group[0]!.id}-tc` });
    group = [];
  };
  for (const item of turn.items) {
    if (item.kind === "tool_use") {
      if (isTodoTool(item.name)) continue;
      if (item.thread === undefined) {
        group.push(item);
        continue;
      }
      flush();
      seg.push({ kind: "subagent", toolUse: item, thread: item.thread, key: `sa-${item.id}` });
      continue;
    }
    flush();
    if ((item.kind === "message" && item.text.trim()) || item.kind === "note") {
      seg.push({ kind: "message", message: item, key: item.id });
    } else if (item.kind === "user_message") {
      // A message the person sent while the turn worked, where it read it.
      seg.push({ kind: "message", message: { kind: "user", id: item.id, text: item.text }, key: item.id });
    }
  }
  flush();

  if (includeFileReviewRecords) {
    // A set is settled once every file is decided, or its turn ended. This is
    // the only trace a shell-made change — which has no edit row — leaves.
    for (const set of turn.fileReview) {
      if ((set.undecided && !turn.ended) || set.files.length === 0) continue;
      seg.push({ kind: "file-review-record", set, key: `${runId}-frr-${set.changeSetId}` });
    }
  }

  return seg;
}

/**
 * Builds the full thread item list and the index at which the live region
 * begins (`liveStart`).
 *
 * The split is by turn: every turn before the first one that has not ended
 * is immutable history (safe for ink's append-only `<Static>`), while the
 * live turn's items — plus the trailing transient items (phase, approvals,
 * optimistic message) — stay live so their review badges can transition and
 * the optimistic message can be cleared without shrinking the Static array.
 */
function buildThreadItems(
  turns: readonly Turn[],
  runs: readonly Run[],
  pendingUserMessage: string | null | undefined,
  includeApprovals: boolean,
  includeFileReviewRecords: boolean,
  queued: readonly QueuedMessage[] = [],
): { items: ThreadItem[]; liveStart: number } {
  const runsById = new Map<string, Run>();
  for (const run of runs) {
    const id = run.metadata?.id;
    if (id) runsById.set(id, run);
  }
  const shown = turns.filter((turn) => isConversationTurn(turn, runsById.get(turn.runId)));

  const items: ThreadItem[] = [];
  let liveStart: number | undefined;
  for (const turn of shown) {
    if (liveStart === undefined && !turn.ended) liveStart = items.length;
    items.push(...buildTurnSegment(turn, runsById.get(turn.runId), includeFileReviewRecords));
  }
  // No live turn: every turn is history; only the transient tail appended
  // below (e.g. an optimistic pending message) stays live.
  liveStart ??= items.length;

  // --- Transient tail (always live) ---
  const lastTurn = shown.at(-1);
  const lastPhase = lastTurn?.status?.phase;
  if (lastTurn?.ended && lastPhase !== undefined && BADGED_END_PHASES.has(lastPhase)) {
    items.push({ kind: "phase", phase: runPhaseOf(lastPhase), key: `phase-${lastPhase}` });
  }

  if (includeApprovals) {
    for (const ask of lastTurn?.asks ?? []) {
      items.push({ kind: "approval", toolUse: ask, key: `approval-${ask.id}` });
    }
  }

  for (const message of queued) {
    items.push({ kind: "queued-message", message, key: `queued-${message.id}` });
  }

  if (
    pendingUserMessage &&
    lastTurn?.userMessage?.text !== pendingUserMessage &&
    !queued.some((message) => message.text === pendingUserMessage)
  ) {
    items.push({
      kind: "pending-message",
      content: pendingUserMessage,
      key: "pending-user-msg",
    });
  }

  return { items, liveStart };
}

/**
 * Each turn's file reviews from the fold, keyed by run id, and the runs'
 * captured change sets keyed by id — what the file-edit rows badge from.
 */
function fileReviewContextOf(turns: readonly Turn[], runs: readonly Run[]): FileReviewContextValue {
  const fileReviewByRunId = new Map<string, readonly FileReviewSet[]>();
  for (const turn of turns) {
    if (turn.fileReview.length > 0) fileReviewByRunId.set(turn.runId, turn.fileReview);
  }
  const changeSetsById = new Map<string, FileChangeSet>();
  for (const run of runs) {
    for (const set of displayFileChangeSets(run.status)) changeSetsById.set(set.id, set);
  }
  return { fileReviewByRunId, changeSetsById };
}

/**
 * Renders a continuous conversation thread from a session's folded turns in
 * the terminal.
 *
 * Composes {@link MessageEntry}, {@link ToolCallGroup}, {@link SubagentBlock},
 * {@link RunProgress}, {@link ApprovalPrompt}, and (for settled file reviews)
 * {@link FileReviewRecord} into a scrolling terminal log.
 *
 * Ended turns are rendered via Ink's `<Static>` component so they are written
 * once and don't re-render, keeping terminal output efficient for long
 * conversations. The live turn renders live so its file-review row badges
 * transition (Pending review → Kept/Discarded) in place, then freeze into
 * `<Static>` when it ends. The thread is wrapped in a `FileReviewContext`
 * provider so every {@link ToolCallItem} can badge its file edits.
 */
export function MessageThread({
  turns,
  runs = EMPTY_RUNS,
  pendingUserMessage,
  queued,
  onAnswerToolUse,
  answeringToolUseIds,
  expandToolCalls = false,
  showFileReviewRecords = false,
  canAnswer = true,
  live = true,
}: MessageThreadProps) {
  const includeApprovals = onAnswerToolUse != null;
  const { items, liveStart } = useMemo(
    () =>
      buildThreadItems(
        turns,
        runs,
        pendingUserMessage,
        includeApprovals,
        showFileReviewRecords,
        queued,
      ),
    [turns, runs, pendingUserMessage, includeApprovals, showFileReviewRecords, queued],
  );

  const fileReviewContext = useMemo(() => fileReviewContextOf(turns, runs), [turns, runs]);

  // The single active decision surface: stdin is delivered to every mounted
  // `useInput`, so only the FIRST waiting tool use owns the keyboard — the rest
  // render inert. The file-review prompt (in `SessionView`) in turn yields while
  // any tool use waits, so the terminal always has exactly one interactive
  // decision surface: first ask → else the file-review prompt.
  const firstApprovalKey = useMemo(
    () => (canAnswer ? items.find((it) => it.kind === "approval")?.key : undefined),
    [items, canAnswer],
  );

  const historyItems = live ? items.slice(0, liveStart) : [];
  const liveItems = live ? items.slice(liveStart) : items;
  const render = (item: ThreadItem): React.ReactNode =>
    renderItem(item, onAnswerToolUse, answeringToolUseIds, expandToolCalls, firstApprovalKey);

  return (
    <FileReviewContext.Provider value={fileReviewContext}>
      <Box flexDirection="column">
        <Static items={historyItems}>
          {(item) => (
            <Box key={item.key} flexDirection="column" marginBottom={1}>
              {render(item)}
            </Box>
          )}
        </Static>

        {liveItems.map((item) => (
          <Box key={item.key} flexDirection="column" marginBottom={1}>
            {render(item)}
          </Box>
        ))}
      </Box>
    </FileReviewContext.Provider>
  );
}

function renderItem(
  item: ThreadItem,
  onAnswerToolUse: MessageThreadProps["onAnswerToolUse"],
  answeringToolUseIds: ReadonlySet<string> | undefined,
  expandToolCalls: boolean,
  activeApprovalKey: string | undefined,
): React.ReactNode {
  switch (item.kind) {
    case "message":
      return <MessageEntry message={item.message} />;
    case "tool-group":
      return <ToolCallGroup toolUses={item.toolUses} defaultExpanded={expandToolCalls} />;
    case "subagent":
      return (
        <SubagentBlock
          thread={item.thread}
          subject={subagentSubjectOf(item.toolUse)}
          startedAt={item.toolUse.processedAt}
          completedAt={item.toolUse.result?.processedAt ?? ""}
          defaultExpanded={expandToolCalls}
        />
      );
    case "phase":
      return <RunProgress phase={item.phase} />;
    case "file-review-record":
      return <FileReviewRecord fileReviewSet={item.set} />;
    case "approval":
      return onAnswerToolUse ? (
        <ApprovalPrompt
          toolUse={item.toolUse}
          onAnswer={(answer, denyMessage) => onAnswerToolUse(item.toolUse.id, answer, denyMessage)}
          isSubmitting={answeringToolUseIds?.has(item.toolUse.id) ?? false}
          // Only the first waiting tool use is interactive (see firstApprovalKey).
          isActive={item.key === activeApprovalKey}
        />
      ) : null;
    case "pending-message":
      return (
        <Box paddingLeft={1}>
          <Text dimColor italic>
            {item.content}
          </Text>
        </Box>
      );
    case "queued-message":
      return (
        <Box paddingLeft={1} flexDirection="column">
          <Text dimColor>{item.message.text}</Text>
          <Text dimColor italic>
            {item.message.state === "waiting" ? QUEUED_MESSAGE_LABEL : DROPPED_MESSAGE_LABEL}
          </Text>
        </Box>
      );
  }
}
