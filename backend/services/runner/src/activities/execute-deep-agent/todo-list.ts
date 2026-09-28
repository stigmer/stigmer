/**
 * The parent's to-do list: langchain's `todoListMiddleware`, with Stigmer's
 * words for its tool and its system line.
 *
 * Why the middleware and not our own: it owns the `todos` state channel, the
 * tool, and the refusal of two list updates in one response, and the
 * product reads what it writes (the parent's `write_todos` is what
 * `status.todos` projects and what the clients' progress card renders,
 * `harness/transcript/builder.ts`, `shared/todos.ts`). Parent only: a
 * sub-agent's list never reaches the execution.
 *
 * Why our own words: langchain's defaults are an 11.4 KB tool description
 * and a 1 KB system block, sent on every model call of every turn whether
 * or not a list is kept, and they ask for the list to be updated "as soon
 * as you are done with a step. Do not batch", which the benchmark's
 * per-call record showed as one model call per update, five of seventeen on
 * a multi-part task. These texts keep what the product relies on (a list for
 * multi-step work, the three states the card shows, one item in progress)
 * and ask for each update to ride with the next action.
 *
 * Plan mode's build progress names no tool: its directive says "your to-do
 * list" (`shared/implement-plan-prompt.ts`) and leaves each harness's tool
 * to say what it is, so the description opens by saying exactly that.
 *
 * The system line cannot be empty: the middleware appends it as a block of
 * its own, and an empty option would still send a whitespace block.
 */

import { todoListMiddleware } from "langchain";
import { ENGINE_TOOL } from "./engine-tools.js";

/** The to-do tool's description, as the model reads it. */
export const TODO_TOOL_DESCRIPTION =
  "Your to-do list, shown to the user as your progress. Use it for work of three or more distinct steps, " +
  "or when the user asks for one; skip it for simple or conversational requests.\n" +
  "- Send the whole list each time. Each item is pending, in_progress or completed; keep exactly one " +
  "in_progress while you work.\n" +
  "- Update the list in the same response as your next action, never in a response of its own. Mark an " +
  "item completed as soon as it is done.\n" +
  "- Call this tool at most once per response.";

/** The line the middleware adds to the system prompt. */
export const TODO_SYSTEM_PROMPT =
  `Keep a to-do list with \`${ENGINE_TOOL.writeTodos}\` for work of three or more distinct steps; ` +
  "the user sees it as your progress.";

/** The parent graph's to-do middleware, with Stigmer's texts. */
export function createTodoListMiddleware(): ReturnType<typeof todoListMiddleware> {
  return todoListMiddleware({ toolDescription: TODO_TOOL_DESCRIPTION, systemPrompt: TODO_SYSTEM_PROMPT });
}
