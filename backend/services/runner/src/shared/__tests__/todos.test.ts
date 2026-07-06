/**
 * Unit tests for applyTodoUpdate — the harness-agnostic to-do map projection
 * shared by the Cursor TodoTracker and the native v2/v3 status builders.
 *
 * These pin the exact mapping contract (status coercion, id synthesis,
 * created_at preservation, merge vs. full-replace, clear-on-empty, defensive
 * input handling, dirty return) so no two writers of status.todos can drift.
 */

import { describe, it, expect } from "vitest";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { applyTodoUpdate } from "../todos.js";

function emptyMap(): { [key: string]: TodoItem } {
  return {};
}

describe("applyTodoUpdate", () => {
  describe("status mapping", () => {
    it("maps pending", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A", status: "pending" }], { merge: false });
      expect(m["todo-0"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("maps in_progress (snake_case)", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A", status: "in_progress" }], { merge: false });
      expect(m["todo-0"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
    });

    it("maps inProgress (camelCase, via toLowerCase)", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A", status: "inProgress" }], { merge: false });
      expect(m["todo-0"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
    });

    it("maps completed", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A", status: "completed" }], { merge: false });
      expect(m["todo-0"].status).toBe(TodoStatus.TODO_COMPLETED);
    });

    it("maps cancelled (Cursor superset)", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A", status: "cancelled" }], { merge: false });
      expect(m["todo-0"].status).toBe(TodoStatus.TODO_CANCELLED);
    });

    it("defaults unknown status to pending", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A", status: "bogus" }], { merge: false });
      expect(m["todo-0"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("defaults missing status to pending", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A" }], { merge: false });
      expect(m["todo-0"].status).toBe(TodoStatus.TODO_PENDING);
    });
  });

  describe("id synthesis", () => {
    it("uses a provided id", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "t1", content: "A", status: "pending" }], { merge: false });
      expect(Object.keys(m)).toEqual(["t1"]);
      expect(m["t1"].id).toBe("t1");
    });

    it("falls back to todo-<index> when id is absent", () => {
      const m = emptyMap();
      applyTodoUpdate(
        m,
        [
          { content: "A", status: "pending" },
          { content: "B", status: "completed" },
        ],
        { merge: false },
      );
      expect(Object.keys(m)).toEqual(["todo-0", "todo-1"]);
    });

    it("falls back to todo-<index> when id is an empty string", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "", content: "A", status: "pending" }], { merge: false });
      expect(Object.keys(m)).toEqual(["todo-0"]);
    });
  });

  describe("timestamps", () => {
    it("sets created_at from raw.created_at on full-replace", () => {
      const m = emptyMap();
      applyTodoUpdate(
        m,
        [{ id: "t1", content: "A", status: "pending", created_at: "2026-01-01T00:00:00Z" }],
        { merge: false, now: "2026-06-06T06:06:06Z" },
      );
      expect(m["t1"].createdAt).toBe("2026-01-01T00:00:00Z");
    });

    it("uses now for created_at when raw.created_at is absent (full-replace)", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A", status: "pending" }], {
        merge: false,
        now: "2026-06-06T06:06:06Z",
      });
      expect(m["todo-0"].createdAt).toBe("2026-06-06T06:06:06Z");
    });

    it("always bumps updated_at to now", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ content: "A", status: "pending" }], {
        merge: false,
        now: "2026-06-06T06:06:06Z",
      });
      expect(m["todo-0"].updatedAt).toBe("2026-06-06T06:06:06Z");
    });

    it("preserves created_at from the prior entry ONLY on merge", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "t1", content: "A", status: "pending" }], {
        merge: false,
        now: "2026-01-01T00:00:00Z",
      });
      applyTodoUpdate(m, [{ id: "t1", content: "A", status: "completed" }], {
        merge: true,
        now: "2026-02-02T00:00:00Z",
      });
      expect(m["t1"].createdAt).toBe("2026-01-01T00:00:00Z");
      expect(m["t1"].updatedAt).toBe("2026-02-02T00:00:00Z");
      expect(m["t1"].status).toBe(TodoStatus.TODO_COMPLETED);
    });

    it("does NOT preserve created_at on full-replace of the same id", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "t1", content: "A", status: "pending" }], {
        merge: false,
        now: "2026-01-01T00:00:00Z",
      });
      applyTodoUpdate(m, [{ id: "t1", content: "A", status: "pending" }], {
        merge: false,
        now: "2026-02-02T00:00:00Z",
      });
      expect(m["t1"].createdAt).toBe("2026-02-02T00:00:00Z");
    });
  });

  describe("merge vs. full-replace", () => {
    it("full-replace clears prior entries", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "a", content: "A", status: "pending" }], { merge: false });
      applyTodoUpdate(m, [{ id: "b", content: "B", status: "pending" }], { merge: false });
      expect(Object.keys(m)).toEqual(["b"]);
    });

    it("merge preserves other existing entries", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "a", content: "A", status: "pending" }], { merge: false });
      applyTodoUpdate(m, [{ id: "b", content: "B", status: "pending" }], { merge: true });
      expect(Object.keys(m).sort()).toEqual(["a", "b"]);
    });

    it("merge updates an existing entry by id", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "a", content: "A", status: "pending" }], { merge: false });
      applyTodoUpdate(m, [{ id: "a", content: "A2", status: "completed" }], { merge: true });
      expect(m["a"].content).toBe("A2");
      expect(m["a"].status).toBe(TodoStatus.TODO_COMPLETED);
    });
  });

  describe("clear-on-empty", () => {
    it("clears the map on empty array + full-replace and reports a change", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "a", content: "A", status: "pending" }], { merge: false });
      const changed = applyTodoUpdate(m, [], { merge: false });
      expect(changed).toBe(true);
      expect(Object.keys(m)).toHaveLength(0);
    });

    it("does NOT clear and reports no change on empty array + merge", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "a", content: "A", status: "pending" }], { merge: false });
      const changed = applyTodoUpdate(m, [], { merge: true });
      expect(changed).toBe(false);
      expect(Object.keys(m)).toEqual(["a"]);
    });

    it("treats a non-array payload like empty (clears on full-replace)", () => {
      const m = emptyMap();
      applyTodoUpdate(m, [{ id: "a", content: "A", status: "pending" }], { merge: false });
      const changed = applyTodoUpdate(m, undefined, { merge: false });
      expect(changed).toBe(true);
      expect(Object.keys(m)).toHaveLength(0);
    });
  });

  describe("defensive input handling", () => {
    it("coerces non-object array entries to empty todos", () => {
      const m = emptyMap();
      const changed = applyTodoUpdate(m, ["oops", null, 42], { merge: false });
      expect(changed).toBe(true);
      expect(Object.keys(m)).toEqual(["todo-0", "todo-1", "todo-2"]);
      expect(m["todo-0"].content).toBe("");
      expect(m["todo-0"].status).toBe(TodoStatus.TODO_PENDING);
    });
  });

  describe("dirty return value", () => {
    it("returns true when items are written", () => {
      expect(applyTodoUpdate(emptyMap(), [{ content: "A" }], { merge: false })).toBe(true);
    });
  });
});
