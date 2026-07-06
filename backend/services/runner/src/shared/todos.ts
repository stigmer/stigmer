/**
 * Todo-list projection shared by every harness's status writer.
 *
 * All harnesses expose an agent to-do tool — the Cursor SDK emits `TodoWrite`
 * (legacy) / `updateTodos` (current), the native deepagents harness emits
 * `write_todos` — and each writes the SAME `AgentExecutionStatus.todos` proto
 * map that the clients (React `TodoCard`, CLI) render. This module is the single
 * place that maps a raw tool payload into that map, so the Cursor `TodoTracker`
 * and the native v2/v3 status builders cannot drift in how they build todos.
 *
 * The mapping is a superset of what any one harness emits: the Cursor SDK sends
 * per-item `id`/`created_at` and can send a `merge` flag and camelCase statuses;
 * deepagents sends only `{ content, status }` (three statuses, no id, no merge).
 * One helper handling the superset serves all three writers.
 */

import { create } from "@bufbuild/protobuf";
import { TodoItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { utcTimestamp } from "./status.js";

/**
 * A single raw todo as it arrives in a to-do tool call's arguments. Every field
 * is optional and defensively typed: the Cursor `updateTodos` schema omits
 * per-item `id`, deepagents omits `id`/`created_at`, and the values reach us as
 * untyped JSON (a Cursor `args` string or a protobuf `JsonObject` value).
 */
export interface RawTodoItem {
  id?: string;
  content?: string;
  status?: string;
  created_at?: string;
}

/**
 * Raw status string -> proto `TodoStatus`. Keyed on the lowercased status so
 * the current SDK's camelCase `inProgress` and the legacy snake_case
 * `in_progress` both resolve. `cancelled` is only ever emitted by the Cursor
 * SDK — deepagents' three-status schema never sends it — but it is kept here so
 * the one shared mapping is faithful to every producer. Unknown values fall back
 * to `TODO_PENDING` at the call site.
 */
const STATUS_MAP: Record<string, TodoStatus> = {
  pending: TodoStatus.TODO_PENDING,
  in_progress: TodoStatus.TODO_IN_PROGRESS,
  inprogress: TodoStatus.TODO_IN_PROGRESS,
  completed: TodoStatus.TODO_COMPLETED,
  cancelled: TodoStatus.TODO_CANCELLED,
};

/**
 * Project a to-do tool call's payload into a `status.todos` map, in place.
 * Returns whether the map changed — the caller's "dirty" / force-persist signal.
 *
 * Semantics (identical across all three harness writers):
 *   - Empty or non-array `rawTodos`: a full-replace (`!merge`) clears the map and
 *     is a change; a merge is a no-op (nothing to merge in) and is not.
 *   - Otherwise a full-replace clears first, then every item is (re)written.
 *   - `id` is the provided id or a stable index fallback (`todo-<i>`); order is
 *     the array order, so index ids are stable across full-replace updates.
 *   - `created_at` is preserved from the prior same-id entry ONLY on merge; a
 *     full-replace clears first, so it becomes `raw.created_at || now`. (The
 *     native harness is always full-replace and sends no `created_at`, so a
 *     native todo's `created_at` is `now` on each write — deliberately identical
 *     to the Cursor non-merge path.)
 *   - `updated_at` is always `now`.
 *
 * Note on clearing: an empty full-replace clears the in-memory map, but the Go
 * `update_status` activity replaces persisted todos only when the incoming map
 * is non-empty, so a settled list survives in history — the clear never reaches
 * the record. This is intentional and relied upon by both harnesses.
 */
export function applyTodoUpdate(
  target: { [key: string]: TodoItem },
  rawTodos: unknown,
  opts: { merge: boolean; now?: string },
): boolean {
  const { merge } = opts;
  const now = opts.now ?? utcTimestamp();

  if (!Array.isArray(rawTodos) || rawTodos.length === 0) {
    if (!merge) {
      clearMap(target);
      return true;
    }
    return false;
  }

  if (!merge) {
    clearMap(target);
  }

  for (let i = 0; i < rawTodos.length; i++) {
    const raw = coerceRawTodo(rawTodos[i]);
    const id = raw.id || `todo-${i}`;
    const statusStr = (raw.status ?? "pending").toLowerCase();
    const status = STATUS_MAP[statusStr] ?? TodoStatus.TODO_PENDING;

    // Preserve the original creation time only when merging into an existing
    // entry; a full-replace cleared the map above, so `existing` is undefined.
    const existing = merge ? target[id] : undefined;

    target[id] = create(TodoItemSchema, {
      id,
      content: raw.content ?? "",
      status,
      createdAt: existing?.createdAt || raw.created_at || now,
      updatedAt: now,
    });
  }

  return true;
}

/** Narrow an untyped array element to a {@link RawTodoItem}; non-objects become empty. */
function coerceRawTodo(value: unknown): RawTodoItem {
  return typeof value === "object" && value !== null ? (value as RawTodoItem) : {};
}

/** Delete every key from the map in place (proto map fields have no `.clear()`). */
function clearMap(target: { [key: string]: TodoItem }): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }
}
