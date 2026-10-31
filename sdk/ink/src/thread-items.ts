// The terminal thread as one ordered list of items, each marked settled or
// not, and the rule that splits it: the history Ink writes once (`<Static>`)
// is the longest settled prefix, and everything after it is the live region,
// redrawn in place. A live region shorter than the screen is what keeps Ink
// from clearing the terminal, scrollback included, on every frame; so the
// split is by item, not by turn, and a streaming reply settles block by block.
//
// An item is settled when nothing can change it any more:
//   - every item of an ended turn, and the line it leaves ("Worked for 1m
//     12s", or the badge of a failed or stopped turn);
//   - a person's message, a note, a thinking that finished;
//   - each block of the agent's reply but the last while it is being written
//     (and a list just above the last, which the last may still join);
//   - a tool group whose calls all returned, unless it is the last item of a
//     turn still working (the next call joins it);
//   - a subagent that finished;
//   - a file review's record, drawn once every file is decided. A set decided
//     after what follows its turn was written (the person sent the next
//     message without deciding, which keeps the files) can only be written
//     below it, so it is marked as an earlier turn's.
// The approvals, queued and pending messages at the tail never settle.
//
// `<Static>` prints by position, so what it holds may only ever grow at its
// end: `appendOnce` keeps the items already written and adds the new ones by
// key, so an item is never written twice and history never moves.
//
// Proven by __tests__/thread-items.test.ts.

import type { Token } from "marked";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  isTodoTool,
  syntheticUserPrompt,
  type FileReviewSet,
  type QueuedMessage,
  type Thread,
  type ToolUse,
  type Turn,
} from "@stigmer/client";
import { runPhaseOf, type ThreadMessage } from "@stigmer/react-core";
import { markdownBlocks, settledBlockCount } from "./markdown.js";
import { workedWords } from "./working.js";

/** One item of the terminal thread, with whether anything can still change it. */
export type ThreadItem = (
  | { readonly kind: "subject"; readonly text: string }
  | { readonly kind: "message"; readonly message: ThreadMessage }
  | { readonly kind: "reply-block"; readonly token: Token; readonly first: boolean }
  | { readonly kind: "tool-group"; readonly toolUses: readonly ToolUse[] }
  | { readonly kind: "subagent"; readonly toolUse: ToolUse; readonly thread: Thread }
  | { readonly kind: "phase"; readonly phase: RunPhase }
  | { readonly kind: "worked"; readonly text: string }
  | { readonly kind: "pending-message"; readonly content: string }
  | { readonly kind: "queued-message"; readonly message: QueuedMessage }
  | {
      readonly kind: "file-review-record";
      readonly set: FileReviewSet;
      /** Written below what followed its turn, so it says it is an earlier turn's. */
      readonly earlier?: boolean;
    }
  | { readonly kind: "approval"; readonly toolUse: ToolUse }
  | { readonly kind: "note"; readonly text: string }
) & { readonly key: string; readonly settled: boolean };

/** A line the view writes into the thread that is not sent to the agent: a host command's note. */
export interface ThreadNote {
  /** Unique among the view's notes: the history writes each once, by it. */
  readonly id: string;
  /** The line as written. */
  readonly text: string;
}

/** Notes as thread items: settled at once, each written where the history stands when it is made. */
export function noteItems(notes: readonly ThreadNote[]): ThreadItem[] {
  return notes.map((note) => ({ kind: "note", text: note.text, key: note.id, settled: true }));
}

/** What the thread is built from. */
export interface ThreadInput {
  readonly turns: readonly Turn[];
  readonly runs: readonly Run[];
  readonly pendingUserMessage?: string | null;
  readonly queued?: readonly QueuedMessage[];
  /** Whether the last turn's waiting tool uses are drawn as approval prompts. */
  readonly includeApprovals: boolean;
  /** Whether each decided file review leaves a record at its turn's tail. */
  readonly includeFileReviewRecords: boolean;
}

/** The phases a turn ends with a badge for: everything but a completion. */
const BADGED_END_PHASES: ReadonlySet<string> = new Set(["failed", "cancelled", "terminated"]);

/** The states in which a tool call can still change. */
const OPEN_TOOL_STATES: ReadonlySet<ToolUse["state"]> = new Set(["running", "waiting"]);

/**
 * Whether a folded turn is a turn of the conversation: not a reconcile turn
 * (the message-less run an Undo starts to put files back), known by its run
 * when present, and by having no message and no items otherwise.
 */
function isConversationTurn(turn: Turn, run: Run | undefined): boolean {
  if (run?.spec?.reconcileFileReview === true) return false;
  return turn.userMessage !== undefined || turn.items.length > 0;
}

/**
 * One turn's items: the person's message (the run's rule skips a placeholder
 * or a build turn's label), each thinking, each block of each agent message,
 * each note, each run of consecutive tool uses as a group (to-do calls left
 * out), each subagent as a block, each decided file review's record, and,
 * once the turn ended, the line it leaves.
 */
export function buildTurnSegment(turn: Turn, run: Run | undefined, includeFileReviewRecords: boolean): ThreadItem[] {
  const seg: ThreadItem[] = [];
  const runId = turn.runId;
  const ended = turn.ended;

  const prompt = run ? syntheticUserPrompt(run) : (turn.userMessage?.text ?? "");
  if (prompt) {
    seg.push({
      kind: "message",
      message: { kind: "user", id: turn.userMessage?.id ?? `${runId}.user`, text: prompt },
      key: `${runId}-spec`,
      settled: true,
    });
  }

  let group: ToolUse[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const open = group.some((toolUse) => OPEN_TOOL_STATES.has(toolUse.state));
    seg.push({ kind: "tool-group", toolUses: group, key: `${group[0]!.id}-tc`, settled: ended || !open });
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
      seg.push({ kind: "subagent", toolUse: item, thread: item.thread, key: `sa-${item.id}`, settled: ended || item.thread.state !== "running" });
      continue;
    }
    flush();
    if (item.kind === "message") {
      const writing = item.live && !ended;
      const blocks = markdownBlocks(item.text);
      const settledCount = settledBlockCount(blocks, writing);
      blocks.forEach((token, index) => {
        seg.push({ kind: "reply-block", token, first: index === 0, key: `${item.id}-b${index}`, settled: index < settledCount });
      });
    } else if (item.kind === "thinking") {
      const thinking = item.live && !ended;
      if (thinking || item.text.trim() !== "") {
        seg.push({ kind: "message", message: { ...item, live: thinking }, key: item.id, settled: !thinking });
      }
    } else if (item.kind === "note") {
      seg.push({ kind: "message", message: item, key: item.id, settled: true });
    } else if (item.kind === "user_message") {
      // A message the person sent while the turn worked, where it read it.
      seg.push({ kind: "message", message: { kind: "user", id: item.id, text: item.text }, key: item.id, settled: true });
    }
  }
  flush();

  // A tool group still working may grow: the agent's next call joins it.
  const last = seg.at(-1);
  if (!ended && last?.kind === "tool-group" && last.settled) seg[seg.length - 1] = { ...last, settled: false };

  if (includeFileReviewRecords) {
    // A record is written once, so it waits for the last decision; while a
    // set is undecided its surface is the docked prompt. This is the only
    // trace a shell-made change, which has no edit row, leaves.
    for (const set of turn.fileReview) {
      if (set.undecided || set.files.length === 0) continue;
      seg.push({ kind: "file-review-record", set, key: `${runId}-frr-${set.changeSetId}`, settled: true });
    }
  }

  if (ended && turn.status !== undefined) {
    const phase = turn.status.phase;
    if (BADGED_END_PHASES.has(phase)) {
      seg.push({ kind: "phase", phase: runPhaseOf(phase), key: `${runId}-end`, settled: true });
    } else {
      const worked = workedWords(turn);
      if (worked !== "") seg.push({ kind: "worked", text: worked, key: `${runId}-end`, settled: true });
    }
  }

  return seg;
}

/**
 * The whole thread: each conversation turn's items, then the transient tail
 * (the last turn's approvals, the queued messages, the optimistic message just
 * sent), which never settles.
 */
export function buildThreadItems(input: ThreadInput): ThreadItem[] {
  const { turns, runs, pendingUserMessage, queued = [], includeApprovals, includeFileReviewRecords } = input;
  const runsById = new Map<string, Run>();
  for (const run of runs) {
    const id = run.metadata?.id;
    if (id) runsById.set(id, run);
  }
  const shown = turns.filter((turn) => isConversationTurn(turn, runsById.get(turn.runId)));

  const items: ThreadItem[] = [];
  for (const turn of shown) items.push(...buildTurnSegment(turn, runsById.get(turn.runId), includeFileReviewRecords));

  const lastTurn = shown.at(-1);
  if (includeApprovals) {
    for (const ask of lastTurn?.asks ?? []) {
      items.push({ kind: "approval", toolUse: ask, key: `approval-${ask.id}`, settled: false });
    }
  }

  for (const message of queued) {
    items.push({ kind: "queued-message", message, key: `queued-${message.id}`, settled: false });
  }

  if (
    pendingUserMessage &&
    lastTurn?.userMessage?.text !== pendingUserMessage &&
    !queued.some((message) => message.text === pendingUserMessage)
  ) {
    items.push({ kind: "pending-message", content: pendingUserMessage, key: "pending-user-msg", settled: false });
  }

  return items;
}

/** How many items from the start are settled: the history's share of the thread. */
export function settledPrefixLength(items: readonly { readonly settled: boolean }[]): number {
  const firstOpen = items.findIndex((item) => !item.settled);
  return firstOpen === -1 ? items.length : firstOpen;
}

/**
 * The history after this frame: what was written, then each settled item not
 * written yet, by key, a file review's record that comes before something
 * already written marked as an earlier turn's. Returns `written` itself when
 * nothing is new, so the history Ink holds is unchanged.
 */
export function appendOnce(written: readonly ThreadItem[], settled: readonly ThreadItem[]): readonly ThreadItem[] {
  const keys = new Set(written.map((item) => item.key));
  const fresh: ThreadItem[] = [];
  settled.forEach((item, index) => {
    if (keys.has(item.key)) return;
    const late = item.kind === "file-review-record" && settled.slice(index + 1).some((after) => keys.has(after.key));
    fresh.push(late ? { ...item, earlier: true } : item);
  });
  return fresh.length === 0 ? written : [...written, ...fresh];
}
