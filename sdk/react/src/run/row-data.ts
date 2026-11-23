// Where a host that draws its own screen reads every kind of row the thread
// draws: the public data each kind is built from, and the client's words for
// it where it has some. The row-kind map (`row-kinds.ts`) answers whether a
// host may change a row in our viewer; this one answers where a host drawing
// no viewer at all finds the same data, so the draw-your-own level stays
// whole. A kind added to `ThreadItem` fails to compile until it names its
// sources here, and a source renamed or removed from a public package fails
// too. A test holds the host-customization contract's table ("Drawing your
// own screen") to this map. Imported by tests only, so it adds nothing to a
// bundle.

import type { ToolUse, Turn } from "@stigmer/client";
import type { UseSessionConversationReturn } from "@stigmer/react-core";
import type { ThreadItem } from "./MessageThread.js";

/** A field of the conversation hook's return. */
type ConversationField = `useSessionConversation.${keyof UseSessionConversationReturn & string}`;
/** A field of a turn, as the conversation hook hands it. */
type TurnField = `Turn.${keyof Turn & string}`;
/** A field of a tool call, as a turn's items hold it. */
type ToolUseField = `ToolUse.${keyof ToolUse & string}`;
/** A public name of the conversation core: the package a drawing host installs. */
type CoreName = keyof typeof import("@stigmer/react-core") & string;
/** A public name of the client, for the words a row reads in. */
type ClientName = keyof typeof import("@stigmer/client") & string;
/** Where a row kind's data is public. */
export type RowSource = ConversationField | TurnField | ToolUseField | CoreName;

/** A row kind's data, for a host that draws its own screen. */
export type RowData =
  /** The data it reads, and the client's words for it where a host wants ours. */
  | { readonly reads: readonly [RowSource, ...RowSource[]]; readonly words?: readonly ClientName[] }
  /** No public data, for the reason given. */
  | { readonly reads: "none"; readonly reason: string };

/**
 * Where every row kind's data is public.
 *
 * @internal
 */
export const ROW_DATA = {
  message: {
    reads: ["useSessionConversation.turns", "Turn.userMessage", "Turn.items", "Turn.answer"],
    words: ["syntheticUserPrompt"],
  },
  "queued-message": { reads: ["useSessionConversation.queued", "useSessionConversation.pendingUserMessage"] },
  "approval-request": {
    reads: ["Turn.asks", "useSessionConversation.asks", "useSessionConversation.answerToolUse"],
    words: ["stepPhrase"],
  },
  todos: { reads: ["Turn.todos"], words: ["turnSteps"] },
  "plan-completion": { reads: ["useSessionFiles", "sessionFilesRefreshKey", "useSessionConversation.runs"] },
  "plan-writing": { reads: ["Turn.items", "useSessionConversation.runs"] },
  "setup-progress": { reads: ["useSessionConversation.activeTurn", "useSessionConversation.activeRun", "Turn.liveness"] },
  "recalled-memories": { reads: ["Turn.memory", "useSessionConversation.runs"] },
  "execution-error": { reads: ["Turn.status", "Turn.errors"], words: ["describeTurnEnding"] },
  liveness: { reads: ["Turn.liveness", "useSessionConversation.stopBackgroundCommand"], words: ["describeTurnActivity"] },
  "tool-group": {
    reads: ["Turn.items", "ToolUse.state", "ToolUse.result", "useSessionConversation.customToolUses", "useSessionConversation.answerCustomToolUse"],
    words: ["stepPhrase", "failureWords", "toolPublicName"],
  },
  plan: { reads: ["Turn.todos", "Turn.items"], words: ["turnSteps", "stepPhrase"] },
  "how-it-got-there": { reads: ["Turn.items", "Turn.answer"], words: ["stepPhrase"] },
  subagent: { reads: ["ToolUse.thread"], words: ["stepPhrase"] },
  outcome: {
    reads: ["Turn.fileReview", "Turn.structuredOutput", "useSessionConversation.reviewFileChanges", "useSessionFiles", "sessionFilesRefreshKey"],
  },
  "turn-scores": {
    reads: "none",
    reason: "The scores are a control a data view cannot express, hidden from end users and guests.",
  },
  "phase-badge": { reads: ["Turn.status", "Turn.ended"] },
  "context-compacted": { reads: ["Turn.items"] },
  "agent-version": { reads: ["useSessionConversation.runs", "useAgentVersions", "agentVersionLabel"] },
  "loaded-versions": { reads: ["useSessionConversation.runs"] },
} as const satisfies Record<ThreadItem["kind"], RowData>;
