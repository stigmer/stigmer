// A turn's steps as its plan: the agent's own to-do list, each item with
// the calls the agent made while that item was in progress, and the calls
// made before any list or while nothing on it was in progress. Every
// surface that draws a turn's work as the agent's plan reads this one
// derivation.
//
// It reads only what a session's events fold into a turn
// (@stigmer/session-log): the turn's items in log order. The fold keeps
// every to-do call among them and the latest list on the turn; replaying
// the to-do calls in item order with the fold's own rule (`applyTodoUpdate`)
// gives, at each other call, the item that was in progress when it was made.
// A to-do call counts where the fold counts it: on the primary thread,
// built in (not a connected app's tool of the same name), returned without
// an error.
//
// Trade-offs:
// - The plan is the list the replay ends on, which is the turn's latest
//   list (`Turn.todos`) once every to-do call returned. A call made under an
//   item a later full rewrite dropped has no item to sit under, so it joins
//   the loose calls, in order.
// - A call's place is its position among the turn's items (the order the
//   log first named each), so a call the agent made right after updating
//   its list sits under the item that update put in progress.
// - Only the primary thread's calls are steps here: a subagent's own calls
//   belong to its card, as everywhere else.

import type { Todo, ToolUse, Turn } from "@stigmer/session-log";
import { applyTodoUpdate } from "@stigmer/session-log";
import { resolveToolKind } from "./tool-view.js";

/** One item of the agent's to-do list, with the calls made while it was in progress. */
export interface PlanItem {
  readonly todo: Todo;
  readonly calls: readonly ToolUse[];
}

/** A turn's steps (module header). */
export interface TurnSteps {
  /** The to-do list in order, each item with its calls; empty when the agent keeps no list. */
  readonly plan: readonly PlanItem[];
  /** The calls made before any list, or while nothing on it was in progress, in order: every call when there is no list. */
  readonly loose: readonly ToolUse[];
}

/** Whether `tool` is a to-do call the fold applies (module header). */
function isAppliedTodoCall(tool: ToolUse): boolean {
  return tool.threadId === "" && tool.mcpServerName === "" && resolveToolKind(tool) === "todo" && tool.result !== undefined && !tool.result.isError;
}

/** `turn`'s steps: its plan and its loose calls (module header). */
export function turnSteps(turn: Turn): TurnSteps {
  const list = new Map<string, Todo>();
  const callsById = new Map<string, ToolUse[]>();
  const placed: { readonly tool: ToolUse; readonly todoId: string | undefined }[] = [];
  for (const item of turn.items) {
    if (item.kind !== "tool_use" || item.threadId !== "") continue;
    if (resolveToolKind(item) === "todo" && item.mcpServerName === "") {
      if (isAppliedTodoCall(item)) {
        applyTodoUpdate(list, item.input["todos"], { merge: item.input["merge"] === true, now: item.result!.processedAt });
      }
      continue;
    }
    const current = [...list.values()].find((todo) => todo.status === "in_progress");
    placed.push({ tool: item, todoId: current?.id });
  }
  const loose: ToolUse[] = [];
  for (const { tool, todoId } of placed) {
    if (todoId === undefined || !list.has(todoId)) {
      loose.push(tool);
      continue;
    }
    callsById.set(todoId, [...(callsById.get(todoId) ?? []), tool]);
  }
  const plan = [...list.values()].map((todo) => ({ todo, calls: callsById.get(todo.id) ?? [] }));
  return { plan, loose };
}
