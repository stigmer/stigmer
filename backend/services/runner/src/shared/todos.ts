/**
 * Todo-list projection the one transcript builder applies for every harness.
 *
 * All harnesses expose an agent to-do tool — the Stigmer (deepagents) harness
 * emits `write_todos`, the Claude engine `TodoWrite` — and each writes the SAME `RunStatus.todos` proto map. The
 * rule itself (full replace or merge, index ids, which creation time is
 * kept, the status words) is `@stigmer/session-log`'s `applyTodoUpdate`,
 * which every client folding a session's events applies to the same calls,
 * so the list a run records and the list a client shows cannot drift. This
 * module only carries that rule onto the proto map.
 */

import { create } from "@bufbuild/protobuf";
import { applyTodoUpdate as applyTodoRule, type Todo } from "@stigmer/session-log";
import { utcTimestamp } from "./status.js";
import { TodoItemSchema, type TodoItem } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { TodoStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const STATUS_OF: Readonly<Record<Todo["status"], TodoStatus>> = {
  pending: TodoStatus.TODO_PENDING,
  in_progress: TodoStatus.TODO_IN_PROGRESS,
  completed: TodoStatus.TODO_COMPLETED,
  cancelled: TodoStatus.TODO_CANCELLED,
};

const WORD_OF: ReadonlyMap<TodoStatus, Todo["status"]> = new Map(
  (Object.entries(STATUS_OF) as Array<[Todo["status"], TodoStatus]>).map(([word, status]) => [status, word]),
);

/**
 * Project a to-do tool call's payload into a `rows.todos` map, in place.
 * Returns whether the map changed — the caller's "dirty" / force-persist
 * signal. The rule is `@stigmer/session-log`'s (module header); `now`
 * defaults to the current UTC instant.
 *
 * Note on clearing: an empty full-replace clears the in-memory map, but the
 * server replaces persisted todos only when the incoming map is non-empty,
 * so a settled list survives in history — the clear never reaches the
 * record. This is intentional and relied upon by both harnesses.
 */
export function applyTodoUpdate(
  target: { [key: string]: TodoItem },
  rawTodos: unknown,
  opts: { merge: boolean; now?: string },
): boolean {
  const list = new Map<string, Todo>(
    Object.values(target).map((item) => [
      item.id,
      {
        id: item.id,
        content: item.content,
        status: WORD_OF.get(item.status) ?? "pending",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    ]),
  );
  const changed = applyTodoRule(list, rawTodos, { merge: opts.merge, now: opts.now ?? utcTimestamp() });
  if (!changed) return false;
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  for (const todo of list.values()) {
    target[todo.id] = create(TodoItemSchema, { ...todo, status: STATUS_OF[todo.status] });
  }
  return true;
}
