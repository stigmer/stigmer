/**
 * Pins the to-do rule (../todos.ts): which calls write the list, a full
 * replace and a merge, ids by index when an item has none, creation kept
 * only on merge, every status word (camelCase and snake_case), an unknown
 * status as pending, and empty or malformed input.
 */
import { describe, expect, it } from "vitest";

import { applyTodoUpdate, isTodoTool } from "../todos.js";
import type { Todo } from "../types.js";

describe("isTodoTool", () => {
  it("names each engine's to-do tool, and nothing else", () => {
    expect(["write_todos", "TodoWrite"].map(isTodoTool)).toEqual([true, true]);
    expect(["read_file", "Bash", "anything"].map(isTodoTool)).toEqual([false, false, false]);
  });
});

describe("applyTodoUpdate", () => {
  it("a full replace writes every item, by index when it has no id, with every status word", () => {
    const list = new Map<string, Todo>([["old", { id: "old", content: "x", status: "pending", createdAt: "t0", updatedAt: "t0" }]]);
    expect(
      applyTodoUpdate(
        list,
        [
          { content: "a", status: "pending" },
          { content: "b", status: "inProgress" },
          { content: "c", status: "in_progress" },
          { content: "d", status: "Completed" },
          { content: "e", status: "cancelled" },
          { content: "f", status: "weird" },
          { content: "g" },
          "not an object",
        ],
        { merge: false, now: "t1" },
      ),
    ).toBe(true);
    expect([...list.values()].map((t) => [t.id, t.content, t.status, t.createdAt])).toEqual([
      ["todo-0", "a", "pending", "t1"],
      ["todo-1", "b", "in_progress", "t1"],
      ["todo-2", "c", "in_progress", "t1"],
      ["todo-3", "d", "completed", "t1"],
      ["todo-4", "e", "cancelled", "t1"],
      ["todo-5", "f", "pending", "t1"],
      ["todo-6", "g", "pending", "t1"],
      ["todo-7", "", "pending", "t1"],
    ]);
  });

  it("a merge keeps the list, updates an item by id and keeps its creation; a replace takes the item's own", () => {
    const list = new Map<string, Todo>();
    applyTodoUpdate(list, [{ id: "a", content: "one", status: "pending", created_at: "c0" }], { merge: false, now: "t1" });
    applyTodoUpdate(list, [{ id: "b", content: "two" }], { merge: true, now: "t2" });
    applyTodoUpdate(list, [{ id: "a", content: "one", status: "completed", created_at: "ignored" }], { merge: true, now: "t3" });
    expect([...list.values()].map((t) => [t.id, t.status, t.createdAt, t.updatedAt])).toEqual([
      ["a", "completed", "c0", "t3"],
      ["b", "pending", "t2", "t2"],
    ]);
  });

  it("empty or non-array input clears on a replace and changes nothing on a merge", () => {
    const list = new Map<string, Todo>([["a", { id: "a", content: "x", status: "pending", createdAt: "t", updatedAt: "t" }]]);
    expect(applyTodoUpdate(list, [], { merge: true, now: "t" })).toBe(false);
    expect(applyTodoUpdate(list, "nope", { merge: true, now: "t" })).toBe(false);
    expect(list.size).toBe(1);
    expect(applyTodoUpdate(list, undefined, { merge: false, now: "t" })).toBe(true);
    expect(list.size).toBe(0);
  });
});
