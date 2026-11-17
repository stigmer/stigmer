import type { ComponentType } from "react";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  TodoRow,
  type ApprovalCardProps,
  type LivenessStatusLineProps,
  type MessageEntryProps,
  type MessageThreadSlots,
  type PlanCompletionCardProps,
  type PlanFileCardProps,
  type PlanStreamingCardProps,
  type RecalledMemoriesCardProps,
  type RunErrorNoticeProps,
  type SetupProgressProps,
  type TodoCardProps,
  type TodoRowProps,
} from "../index.js";

// Root-surface pin for MessageThread's slots (stigmer/stigmer#2903): an
// embedder restyling one slot imports the slot map, the slot's props type and
// the built-in it may delegate to from the root, where `MessageThread` is
// exported. The map below names every slot's props type through the root
// barrel, and the typecheck gate (`tsc --noEmit`) holds it equal to the slots
// themselves, so a slot added without its root props export fails this file.

/** The props each slot's component receives, read from the slot map itself. */
type SlotProps = {
  readonly [K in keyof MessageThreadSlots]-?: NonNullable<MessageThreadSlots[K]> extends ComponentType<infer P> ? P : never;
};

/** Every slot's props type, each named from the package root. */
type RootSlotProps = {
  readonly MessageEntry: MessageEntryProps;
  readonly ApprovalCard: ApprovalCardProps;
  readonly TodoCard: TodoCardProps;
  readonly TodoRow: TodoRowProps;
  readonly PlanFileCard: PlanFileCardProps;
  readonly PlanCompletionCard: PlanCompletionCardProps;
  readonly PlanStreamingCard: PlanStreamingCardProps;
  readonly SetupProgress: SetupProgressProps;
  readonly RecalledMemoriesCard: RecalledMemoriesCardProps;
  readonly RunErrorNotice: RunErrorNoticeProps;
  readonly LivenessStatusLine: LivenessStatusLineProps;
};

describe("MessageThread's slots from the package root", () => {
  it("names every slot's props type from the root", () => {
    expectTypeOf<RootSlotProps>().toEqualTypeOf<SlotProps>();
  });

  it("exports the built-in to-do row an override can delegate to", () => {
    const slots: MessageThreadSlots = { TodoRow: (props: TodoRowProps) => TodoRow(props) };
    expect(slots.TodoRow).toBeTypeOf("function");
  });
});
