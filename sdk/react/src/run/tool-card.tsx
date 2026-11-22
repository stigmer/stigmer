"use client";

// How the thread meets a host's own tool cards (`toolCards` on
// `StigmerProvider`): which call has one, the narrowed view the card
// receives, and the one test every place that closes or groups steps asks,
// so a call with a host card is never folded out of sight. A card that
// throws draws our body through the kit's one host-part boundary
// (`internal/HostPartBoundary.tsx`).

import { createContext, useContext, useMemo, type ComponentType } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import { redactSecretArgs, stepTense, toolPublicName, type ToolUse } from "@stigmer/client";
import { ToolCardsContext, type ToolCallInfo, type ToolCallState, type ToolCardProps, type ToolCards } from "./tool-cards-context.js";

/** Whether a tool call has a host's card the thread must keep in view. */
export type HasToolCard = (tool: ToolUse) => boolean;

/** The test where no call has a card: no map, or the cards are shown above the fold. */
export const NO_TOOL_CARD: HasToolCard = () => false;

/**
 * True inside a finished turn's "How it got there" fold, whose host cards
 * the thread draws once, above the fold: there a row draws our body and
 * nothing is kept open for a card.
 *
 * @internal
 */
export const CardsLiftedContext = createContext(false);

/** The host's card for a call: its public name's own entry in the map, never an inherited one (`constructor`). */
export function hostCardOf(cards: ToolCards | null, tool: Pick<ToolUse, "name" | "mcpServerName">): ComponentType<ToolCardProps> | undefined {
  if (cards === null) return undefined;
  const name = toolPublicName(tool);
  return name !== undefined && Object.hasOwn(cards, name) ? cards[name] : undefined;
}

/** @internal The host's card for this row's call, or undefined where it has none or it is shown above the fold. */
export function useHostCard(tool: ToolUse): ComponentType<ToolCardProps> | undefined {
  const cards = useContext(ToolCardsContext);
  const lifted = useContext(CardsLiftedContext);
  return lifted ? undefined : hostCardOf(cards, tool);
}

/** @internal The host's card for a call drawn above the fold, where the lift itself is the reason to draw it. */
export function useLiftedHostCard(tool: ToolUse): ComponentType<ToolCardProps> | undefined {
  return hostCardOf(useContext(ToolCardsContext), tool);
}

/**
 * @internal The thread's test for a call with a host card, stable while the
 * provider's map is: {@link NO_TOOL_CARD} with no map, and inside a fold whose
 * cards are drawn above it.
 */
export function useHasToolCard(): HasToolCard {
  const cards = useContext(ToolCardsContext);
  const lifted = useContext(CardsLiftedContext);
  return useMemo(() => (cards === null || lifted ? NO_TOOL_CARD : (tool: ToolUse) => hostCardOf(cards, tool) !== undefined), [cards, lifted]);
}

/**
 * Whether a call, or a step of the helper it started at any depth, has a
 * host card: a to-do item or a helper holding one stays open.
 */
export function holdsToolCard(tool: ToolUse, hasCard: HasToolCard): boolean {
  if (hasCard === NO_TOOL_CARD) return false;
  if (hasCard(tool)) return true;
  return tool.thread?.items.some((item) => item.kind === "tool_use" && holdsToolCard(item, hasCard)) === true;
}

/** The calls with a host card in a list of a turn's items, a helper's included at any depth, in the order they were made. */
export function toolCardCalls(items: ReadonlyArray<{ readonly kind: string }>, hasCard: HasToolCard, into: ToolUse[] = []): ToolUse[] {
  if (hasCard === NO_TOOL_CARD) return into;
  for (const item of items) {
    if (item.kind !== "tool_use") continue;
    const tool = item as ToolUse;
    if (hasCard(tool)) into.push(tool);
    if (tool.thread !== undefined) toolCardCalls(tool.thread.items, hasCard, into);
  }
  return into;
}

/** How a call stands for a card, by the row's own failure rule: a result that says it failed is a failure. */
function cardStateOf(tool: ToolUse): ToolCallState {
  switch (tool.state) {
    case "denied":
      return "denied";
    case "stopped":
      return "stopped";
    case "waiting":
      return "needs-approval";
    case "waiting_on_host":
      return "waiting-on-host";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "completed":
      return stepTense(tool) === "failed" ? "failed" : "completed";
  }
}

/**
 * The narrowed view of a call a host's card receives. Rows the runner wrote
 * before it redacted inputs still carry secret values, so they are hidden
 * here too.
 */
export function toolCallInfoOf(tool: ToolUse, sessionId: string): ToolCallInfo {
  const result = tool.result;
  return {
    id: tool.id,
    tool: tool.name,
    server: tool.mcpServerName,
    // The redaction keeps every value but the secret ones, which become a
    // string: still JSON.
    input: redactSecretArgs(tool.input) as JsonObject,
    state: cardStateOf(tool),
    result: result === undefined ? undefined : { text: result.text, isError: result.isError, truncated: tool.fullOutput !== undefined },
    sessionId,
    runId: tool.runId,
  };
}
