"use client";

// How the thread meets a host's own tool cards (`toolCards` on
// `StigmerProvider`): which call has one, the narrowed view the card
// receives, the boundary that puts our body back when a card throws, and the
// one test every place that closes or groups steps asks, so a call with a
// host card is never folded out of sight.

import { Component, createContext, useContext, useMemo, type ComponentType, type ErrorInfo, type ReactNode } from "react";
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

interface ToolCardBoundaryProps {
  /** What draws when the card threw: the kit's own body for the call. */
  readonly fallback: ReactNode;
  /** The call's state: once the card threw, a new state gives it a fresh try. */
  readonly state: ToolCallState;
  readonly children: ReactNode;
}

interface ToolCardBoundaryState {
  /**
   * The call's state when the card threw, `"caught"` between the throw and
   * its report, or null while the card draws.
   */
  readonly failedIn: ToolCallState | "caught" | null;
}

/**
 * Puts the kit's own body back when a host's card throws. A card that threw
 * while its call ran gets one fresh try once the call's state moves (its
 * result landed); a card that draws is never remounted, so it keeps its own
 * state across the call's states. React reports the error as it does for
 * any boundary.
 *
 * @internal
 */
export class ToolCardBoundary extends Component<ToolCardBoundaryProps, ToolCardBoundaryState> {
  override state: ToolCardBoundaryState = { failedIn: null };

  static getDerivedStateFromError(): ToolCardBoundaryState {
    return { failedIn: "caught" };
  }

  static getDerivedStateFromProps(props: ToolCardBoundaryProps, state: ToolCardBoundaryState): ToolCardBoundaryState | null {
    // A fresh try once the call moved on from the state the card threw in.
    return state.failedIn !== null && state.failedIn !== "caught" && state.failedIn !== props.state ? { failedIn: null } : null;
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.setState({ failedIn: this.props.state });
  }

  override render(): ReactNode {
    return this.state.failedIn !== null ? this.props.fallback : this.props.children;
  }
}
