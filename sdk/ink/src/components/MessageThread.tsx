// The terminal conversation: a session's folded turns as a scrolling log —
// each turn's message, the agent's thinking, messages, tool groups and
// subagents in the order it produced them, its decided file reviews, how each
// turn ended, the last turn's waiting tool uses as approval prompts, and the
// optimistic message just sent. What can no longer change is written once
// through Ink's <Static> (thread-items.ts says what that is); the rest
// re-renders in place. Off a live screen (`live` false), where Ink writes one
// frame at exit, the whole thread is that frame.
import React, { useMemo, useRef } from "react";
import { Box, Text, Static } from "ink";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { displayFileChangeSets, type FileReviewSet, type QueuedMessage, type Turn } from "@stigmer/client";
import {
  FileReviewContext,
  subagentSubjectOf,
  type FileReviewContextValue,
  type ToolUseAnswer,
} from "@stigmer/react-core";
import { appendOnce, buildThreadItems, settledPrefixLength, type ThreadItem } from "../thread-items.js";
import { AgentLabel, MessageEntry } from "./MessageEntry.js";
import { MarkdownBlock } from "./Markdown.js";
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
   * Whether to render a read-only record for each decided file review (every
   * file decided) — the terminal analogue of the web's in-thread record. Off
   * by default so bare consumers stay minimal; `SessionView` opts in. A set
   * still undecided is never a record here — its decision surface is the
   * docked `FileReviewPrompt` — so the record, written once, never goes stale.
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
  /**
   * The session's subject, drawn once as the thread's first line when it is
   * known before anything is written to the history. Omitted, none is drawn.
   */
  readonly subject?: string;
}

/** What a message sent while a turn worked says while no turn has read it. */
export const QUEUED_MESSAGE_LABEL = "Queued — read at the agent's next step";
/** What a queued message says once a stop ended the turn before it was read. */
export const DROPPED_MESSAGE_LABEL = "Not read — the turn was stopped";

const EMPTY_RUNS: readonly Run[] = [];
const NO_REVIEWS: ReadonlyMap<string, readonly FileReviewSet[]> = new Map();

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
 * Composes {@link MessageEntry}, {@link MarkdownBlock}, {@link ToolCallGroup},
 * {@link SubagentBlock}, {@link RunProgress}, {@link ApprovalPrompt}, and (for
 * decided file reviews) {@link FileReviewRecord} into a scrolling terminal log.
 *
 * What can no longer change is written once through Ink's `<Static>`, by item
 * rather than by turn (thread-items.ts): a reply's finished blocks, a tool
 * group whose calls returned, a finished subagent. Only what can still change
 * stays live, so the live region stays small and Ink never clears the
 * terminal. Rows written to the history carry no file-review badge, since a
 * review is decided after they are written; its outcome is the review's own
 * record and the docked prompt.
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
  subject,
}: MessageThreadProps) {
  const includeApprovals = onAnswerToolUse != null;
  const items = useMemo(
    () =>
      buildThreadItems({
        turns,
        runs,
        pendingUserMessage,
        queued,
        includeApprovals,
        includeFileReviewRecords: showFileReviewRecords,
      }),
    [turns, runs, pendingUserMessage, includeApprovals, showFileReviewRecords, queued],
  );

  const fileReviewContext = useMemo(() => fileReviewContextOf(turns, runs), [turns, runs]);
  const historyContext = useMemo(
    () => ({ fileReviewByRunId: NO_REVIEWS, changeSetsById: fileReviewContext.changeSetsById }),
    [fileReviewContext],
  );

  // The single active decision surface: stdin is delivered to every mounted
  // `useInput`, so only the FIRST waiting tool use owns the keyboard — the rest
  // render inert. The file-review prompt (in `SessionView`) in turn yields while
  // any tool use waits, so the terminal always has exactly one interactive
  // decision surface: first ask → else the file-review prompt.
  const firstApprovalKey = useMemo(
    () => (canAnswer ? items.find((it) => it.kind === "approval")?.key : undefined),
    [items, canAnswer],
  );

  // What Ink has written, kept across frames: <Static> prints by position, so
  // its items only ever grow at the end (appendOnce). The subject leads the
  // history when it is known before anything is written; one that resolves
  // later is not written above what is already there.
  const written = useRef<readonly ThreadItem[]>([]);
  const subjectItem: ThreadItem | undefined = subject ? { kind: "subject", text: subject, key: "subject", settled: true } : undefined;
  const settledCount = settledPrefixLength(items);
  let historyItems: readonly ThreadItem[] = [];
  let liveItems: readonly ThreadItem[] = subjectItem ? [subjectItem, ...items] : items;
  if (live) {
    const lead = subjectItem && written.current.length === 0 ? [subjectItem] : [];
    written.current = appendOnce(written.current, [...lead, ...items.slice(0, settledCount)]);
    historyItems = written.current;
    const writtenKeys = new Set(historyItems.map((item) => item.key));
    liveItems = items.slice(settledCount).filter((item) => !writtenKeys.has(item.key));
  }
  const render = (item: ThreadItem): React.ReactNode =>
    renderItem(item, onAnswerToolUse, answeringToolUseIds, expandToolCalls, firstApprovalKey);

  return (
    <FileReviewContext.Provider value={fileReviewContext}>
      <Box flexDirection="column">
        <FileReviewContext.Provider value={historyContext}>
          <Static items={historyItems as ThreadItem[]}>
            {(item) => (
              <Box key={item.key} flexDirection="column" marginBottom={1}>
                {render(item)}
              </Box>
            )}
          </Static>
        </FileReviewContext.Provider>

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
    case "subject":
      return (
        <Box paddingLeft={1}>
          <Text dimColor bold>
            {item.text}
          </Text>
        </Box>
      );
    case "message":
      return <MessageEntry message={item.message} expanded={expandToolCalls} />;
    case "reply-block":
      return (
        <Box flexDirection="column" paddingLeft={1}>
          {item.first && <AgentLabel />}
          <MarkdownBlock token={item.token} />
        </Box>
      );
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
    case "worked":
      return (
        <Box paddingLeft={1}>
          <Text dimColor>✻ {item.text}</Text>
        </Box>
      );
    case "file-review-record":
      return <FileReviewRecord fileReviewSet={item.set} earlier={item.earlier} />;
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
