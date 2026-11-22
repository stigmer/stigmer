// Every kind of row the thread draws, decided: open to a host (and through
// which slots), its body open to a host's tool card, the kit's own, or
// closed, each with its reason in the words of the host-customization
// contract (`.agents/skills/sdk-console-architecture/references/host-customization.md`,
// "Every part and its decision"). A kind added to `ThreadItem` fails to
// compile until it is decided here, and a slot added to `MessageThreadSlots`
// fails until an open kind names it; a test holds the contract's table to
// this map. Imported by tests only, so it adds nothing to a bundle.

import type { MessageThreadSlots, ThreadItem } from "./MessageThread.js";

/** A slot's name: the built-in component it replaces. */
type SlotName = keyof MessageThreadSlots;

/** A row kind's decision, in the contract's terms. */
export type RowKindDecision =
  /** A host replaces the row through these slots. */
  | { readonly decision: "open"; readonly slots: readonly [SlotName, ...SlotName[]]; readonly reason: string }
  /** The row is closed; a named tool's body opens to a host's tool card. */
  | { readonly decision: "body"; readonly via: "toolCards"; readonly reason: string }
  /** The kit's own entry, drawn through the public mechanisms. */
  | { readonly decision: "kit-owned"; readonly reason: string }
  /** No host seam, for the reason given. */
  | { readonly decision: "closed"; readonly reason: string };

const TURN_STRUCTURE = "The structure of a turn's work, which the viewer's redesigns change (stigmer/stigmer#3046).";
const TRANSCRIPT_INTEGRITY = "The transcript's integrity (which version answered, what was dropped).";

/**
 * The decision for every row kind.
 *
 * @internal
 */
export const ROW_KINDS = {
  message: {
    decision: "open",
    slots: ["MessageEntry"],
    reason: "The slot also receives the message's view and the host's message actions as data.",
  },
  "queued-message": {
    decision: "open",
    slots: ["MessageEntry"],
    reason: "The slot also receives the message's view and the host's message actions as data.",
  },
  "approval-request": {
    decision: "open",
    slots: ["ApprovalCard"],
    reason: "Open for its look, for an ask with no row of its own; an ask inside a tool's row is drawn by that row. What either shows and records is fixed.",
  },
  todos: {
    decision: "open",
    slots: ["TodoCard", "TodoRow"],
    reason: "Replacing either switches off the plan layout a to-do turn draws (the steps go back to time order).",
  },
  "plan-completion": { decision: "open", slots: ["PlanFileCard", "PlanCompletionCard"], reason: "A finished plan turn's card, the host's to draw." },
  "plan-writing": { decision: "open", slots: ["PlanStreamingCard"], reason: "The live stand-in while a plan is written, the host's to draw." },
  "setup-progress": { decision: "open", slots: ["SetupProgress"], reason: "The wait before the first output, the host's to draw." },
  "recalled-memories": { decision: "open", slots: ["RecalledMemoriesCard"], reason: "The recalled-memories card, the host's to draw." },
  "execution-error": {
    decision: "open",
    slots: ["RunErrorNotice"],
    reason: "A host turns the failure into its own recovery; the notice still shows the failure.",
  },
  liveness: { decision: "open", slots: ["LivenessStatusLine"], reason: "The line while a turn works between events, the host's to word." },
  "tool-group": {
    decision: "body",
    via: "toolCards",
    reason: "The row and its step line are closed. The body of a row for a named MCP tool or the host's own custom tool opens to a host's tool card.",
  },
  plan: { decision: "closed", reason: TURN_STRUCTURE },
  "how-it-got-there": { decision: "closed", reason: TURN_STRUCTURE },
  subagent: { decision: "closed", reason: TURN_STRUCTURE },
  outcome: { decision: "closed", reason: "Closed in the viewer: the record of what the turn made and changed." },
  "turn-scores": {
    decision: "kit-owned",
    reason: "The scores of a completed turn with no final answer, at its foot; a turn with one carries them in its final answer's row instead.",
  },
  "phase-badge": { decision: "closed", reason: TRANSCRIPT_INTEGRITY },
  "context-compacted": { decision: "closed", reason: TRANSCRIPT_INTEGRITY },
  "agent-version": { decision: "closed", reason: TRANSCRIPT_INTEGRITY },
  "loaded-versions": { decision: "closed", reason: TRANSCRIPT_INTEGRITY },
} as const satisfies Record<ThreadItem["kind"], RowKindDecision>;

/** The slots some open row kind names. */
type NamedSlots = Extract<(typeof ROW_KINDS)[keyof typeof ROW_KINDS], { readonly decision: "open" }>["slots"][number];

/** `true` while every slot is claimed by an open row kind. */
type EverySlotClaimed = [Exclude<SlotName, NamedSlots>] extends [never] ? true : false;

/**
 * A slot no open row kind names makes {@link EverySlotClaimed} `false`, and
 * this assignment fails to compile.
 *
 * @internal
 */
export const EVERY_SLOT_CLAIMED: EverySlotClaimed = true;
