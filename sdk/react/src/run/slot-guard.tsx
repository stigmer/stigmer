"use client";

// A host's `threadSlots`, guarded once where they enter the thread: each set
// slot becomes a component that draws the host's part and, if it throws, the
// kit's built-in with the same props. Guarding at the entry covers every
// place a slot draws (both thread paths, the failed-send and queued bubbles,
// and the to-do row the built-in to-do card draws deep in its list), with no
// change to the renderer. Unset slots stay unset, so a thread with no slots
// draws exactly the tree it always did.

import type { ComponentType } from "react";
import { HostPartBoundary } from "../internal/HostPartBoundary.js";
import type { MessageThreadSlots } from "./MessageThread.js";
import { MessageEntry } from "./MessageEntry.js";
import { ApprovalCard } from "./ApprovalCard.js";
import { TodoCard } from "./TodoCard.js";
import { TodoRow } from "./TodoList.js";
import { PlanFileCard } from "./PlanFileCard.js";
import { PlanCompletionCard } from "./PlanCompletionCard.js";
import { PlanStreamingCard } from "./PlanStreamingCard.js";
import { SetupProgress } from "./SetupProgress.js";
import { RecalledMemoriesCard } from "./RecalledMemoriesCard.js";
import { RunErrorNotice } from "./RunErrorNotice.js";
import { LivenessStatusLine } from "./LivenessStatusLine.js";

/** A slot's name: the built-in component it replaces. */
export type SlotName = keyof MessageThreadSlots;

/**
 * The kit's own part for every slot, drawn when the host's throws. A slot
 * added to {@link MessageThreadSlots} without its built-in here fails to
 * compile.
 *
 * @internal
 */
export const SLOT_BUILT_INS = {
  MessageEntry,
  ApprovalCard,
  TodoCard,
  TodoRow,
  PlanFileCard,
  PlanCompletionCard,
  PlanStreamingCard,
  SetupProgress,
  RecalledMemoriesCard,
  RunErrorNotice,
  LivenessStatusLine,
} satisfies Required<MessageThreadSlots>;

const SLOT_NAMES = Object.keys(SLOT_BUILT_INS) as SlotName[];

/**
 * A slot's component with its props left opaque. A guarded slot hands the
 * host's part and the built-in the very props it was given, so the slot's
 * own props type holds through it by construction; the casts below only
 * forget and restore it.
 */
type AnySlot = ComponentType<object>;

/**
 * One guarded component per host component and slot, so an inline `slots`
 * literal still hands the rows the same components and their `React.memo`
 * holds.
 */
const guardedByHost = new Map<SlotName, WeakMap<AnySlot, AnySlot>>();

function guardedSlot(name: SlotName, Host: AnySlot): AnySlot {
  let byHost = guardedByHost.get(name);
  if (byHost === undefined) {
    byHost = new WeakMap();
    guardedByHost.set(name, byHost);
  }
  const known = byHost.get(Host);
  if (known !== undefined) return known;

  const BuiltIn = SLOT_BUILT_INS[name] as unknown as AnySlot;
  // Not memoized itself: a host's slot keeps its own memo semantics, and the
  // built-in is drawn only once the host's part threw.
  function GuardedSlot(props: object) {
    return (
      <HostPartBoundary fallback={<BuiltIn {...props} />}>
        <Host {...props} />
      </HostPartBoundary>
    );
  }
  GuardedSlot.displayName = `HostSlot(${Host.displayName ?? (Host.name || name)})`;
  byHost.set(Host, GuardedSlot);
  return GuardedSlot;
}

const guardedBySlots = new WeakMap<MessageThreadSlots, MessageThreadSlots>();

/**
 * The host's slots with each set one guarded: the host's part, and the
 * built-in with the same props once it throws. The same `slots` object
 * always gives the same result.
 *
 * @internal
 */
export function guardSlots(slots: MessageThreadSlots | undefined): MessageThreadSlots | undefined {
  if (slots === undefined) return undefined;
  const known = guardedBySlots.get(slots);
  if (known !== undefined) return known;
  const guarded: Partial<Record<SlotName, AnySlot>> = {};
  for (const name of SLOT_NAMES) {
    const host = slots[name] as unknown as AnySlot | undefined;
    if (host !== undefined) guarded[name] = guardedSlot(name, host);
  }
  const result = guarded as MessageThreadSlots;
  guardedBySlots.set(slots, result);
  return result;
}
