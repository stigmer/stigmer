/**
 * The to-do rule: how one to-do tool call changes a to-do list. Every
 * engine exposes a to-do tool (the native harness's `write_todos`, the
 * Claude engine's `TodoWrite`; each reads as Claude Code's `TodoWrite`,
 * `@stigmer/tool-vocabulary`), and the runner's
 * transcript builder and every client that folds a session's events apply
 * this one rule, so the list a run records and the list a client shows
 * cannot drift.
 *
 * The mapping is a superset of what any one engine sends: it reads a
 * per-item `id` and `created_at`, a `merge` flag and camelCase statuses
 * when a call carries them; the native harness sends only
 * `{ content, status }` (three statuses, no id, no merge), and the Claude
 * engine adds an `activeForm` the list does not keep.
 *
 *   - Empty or non-array `rawTodos`: a full replace (`!merge`) clears the
 *     list and is a change; a merge is a no-op and is not.
 *   - Otherwise a full replace clears first, then every item is written.
 *   - `id` is the item's id or its index (`todo-<i>`), so index ids stay
 *     stable across full replaces.
 *   - `createdAt` is kept from the same id's earlier item only on merge;
 *     otherwise it is the item's own `created_at`, or `now`.
 *   - `updatedAt` is always `now`.
 *
 * Proven by __tests__/todos.test.ts.
 */
import { NATIVE_TOOL_COVERS } from "@stigmer/tool-vocabulary";

import type { Todo } from "./types.js";

/** A to-do as it arrives in a to-do call's input; every field optional. */
interface RawTodo {
  readonly id?: unknown;
  readonly content?: unknown;
  readonly status?: unknown;
  readonly created_at?: unknown;
}

/** A raw status, lowercased, to its word; an unknown status reads pending. */
const STATUS_WORDS: Readonly<Record<string, Todo["status"]>> = {
  pending: "pending",
  in_progress: "in_progress",
  inprogress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
};

/** Whether a built-in tool call of this name writes the to-do list (it reads as `TodoWrite`). */
export function isTodoTool(name: string): boolean {
  const covers = NATIVE_TOOL_COVERS.get(name);
  return covers?.includes("TodoWrite") ?? name === "TodoWrite";
}

/**
 * Applies one to-do call's items to `target` (keyed by id, in order), in
 * place; returns whether the list changed (module header).
 */
export function applyTodoUpdate(
  target: Map<string, Todo>,
  rawTodos: unknown,
  opts: { readonly merge: boolean; readonly now: string },
): boolean {
  const { merge, now } = opts;
  if (!Array.isArray(rawTodos) || rawTodos.length === 0) {
    if (!merge) {
      target.clear();
      return true;
    }
    return false;
  }
  if (!merge) {
    target.clear();
  }
  rawTodos.forEach((value: unknown, index) => {
    const raw: RawTodo = typeof value === "object" && value !== null ? (value as RawTodo) : {};
    const id = text(raw.id) || `todo-${index}`;
    const existing = merge ? target.get(id) : undefined;
    target.set(id, {
      id,
      content: text(raw.content),
      status: STATUS_WORDS[(text(raw.status) || "pending").toLowerCase()] ?? "pending",
      createdAt: existing?.createdAt || text(raw.created_at) || now,
      updatedAt: now,
    });
  });
  return true;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
