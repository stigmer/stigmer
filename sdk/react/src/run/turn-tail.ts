// What a working turn's tail is showing: whether the agent has begun to
// answer, whether something in the thread already shows it is working, and
// which background commands hold the turn once its reply has ended. The
// thread reads them to place its tail line.

import type { ToolUse, Turn, TurnItem } from "@stigmer/client";
import { isBackgroundRunning } from "@stigmer/client";

/**
 * True once the agent has produced any real, renderable response in a turn —
 * a message with text, a thinking (live or with text), or a tool use.
 *
 * Gates the synthetic "Thinking…" setup placeholder: the placeholder is only
 * for the genuine pre-first-content window and must yield the moment any of
 * these appear, otherwise it would render *alongside* the real
 * ThinkingMessage / ToolCallGroup cards (the GitHub #179 duplicate-spinner).
 */
export function hasStartedResponding(turn: Turn): boolean {
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
export function hasVisiblyRunningActivity(items: ReadonlyArray<TurnItem>): boolean {
  return items.some(
    (item) =>
      item.kind === "tool_use" &&
      (item.state === "running" ||
        (item.thread !== undefined &&
          (item.thread.state === "running" || hasVisiblyRunningActivity(item.thread.items)))),
  );
}

/** The background commands a turn's reply has ended on, still running; none while it waits on its model. */
export function backgroundCommandsHolding(turn: Turn): ToolUse[] {
  return turn.liveness !== undefined && turn.liveness.awaitingModelMs === undefined ? runningBackgroundCommands(turn.items) : [];
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
