/**
 * Unit tests for TodoTracker — validates todo extraction from Cursor SDK
 * stream events into AgentExecutionStatus.todos proto map.
 *
 * Covers both the legacy "TodoWrite" tool name and the current SDK
 * "updateTodos" name, along with schema differences (camelCase statuses,
 * absent per-item IDs).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import type { SDKMessage } from "@cursor/sdk";
import { TodoTracker } from "../todo-tracker.js";

function todoToolCall(
  name: string,
  status: "running" | "completed" | "error",
  args?: unknown,
): Extract<SDKMessage, { type: "tool_call" }> {
  return {
    type: "tool_call",
    agent_id: "agent-1",
    run_id: "run-1",
    call_id: "call-1",
    name,
    status,
    args,
  };
}

describe("TodoTracker", () => {
  let todos: { [key: string]: TodoItem };
  let tracker: TodoTracker;

  beforeEach(() => {
    todos = {};
    tracker = new TodoTracker(todos);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  // ---------------------------------------------------------------------------
  // Tool name matching
  // ---------------------------------------------------------------------------

  describe("tool name matching", () => {
    it("processes events with name 'updateTodos'", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Build feature", status: "pending" }],
        }),
      );
      expect(Object.keys(todos)).toHaveLength(1);
      expect(todos["todo-0"].content).toBe("Build feature");
    });

    it("processes events with legacy name 'TodoWrite'", () => {
      tracker.processEvent(
        todoToolCall("TodoWrite", "completed", {
          todos: [{ id: "t1", content: "Fix bug", status: "completed" }],
        }),
      );
      expect(Object.keys(todos)).toHaveLength(1);
      expect(todos["t1"].content).toBe("Fix bug");
    });

    it("ignores events with unrecognized tool names", () => {
      tracker.processEvent(
        todoToolCall("Shell", "completed", {
          todos: [{ content: "Should not appear", status: "pending" }],
        }),
      );
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Event filtering
  // ---------------------------------------------------------------------------

  describe("event filtering", () => {
    it("ignores non-tool_call event types", () => {
      const event: SDKMessage = {
        type: "assistant",
        agent_id: "agent-1",
        run_id: "run-1",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      };
      tracker.processEvent(event);
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("ignores running tool calls (args incomplete)", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "running", {
          todos: [{ content: "Partial", status: "pending" }],
        }),
      );
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("ignores errored tool calls", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "error", {
          todos: [{ content: "Failed", status: "pending" }],
        }),
      );
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Status mapping
  // ---------------------------------------------------------------------------

  describe("status mapping", () => {
    it("maps 'inProgress' (camelCase from current SDK) to TODO_IN_PROGRESS", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Working on it", status: "inProgress" }],
        }),
      );
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
    });

    it("maps 'in_progress' (snake_case legacy) to TODO_IN_PROGRESS", () => {
      tracker.processEvent(
        todoToolCall("TodoWrite", "completed", {
          todos: [{ id: "a", content: "Working", status: "in_progress" }],
        }),
      );
      expect(todos["a"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
    });

    it("maps 'pending' to TODO_PENDING", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Not started", status: "pending" }],
        }),
      );
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("maps 'completed' to TODO_COMPLETED", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Done", status: "completed" }],
        }),
      );
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_COMPLETED);
    });

    it("maps 'cancelled' to TODO_CANCELLED", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Dropped", status: "cancelled" }],
        }),
      );
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_CANCELLED);
    });

    it("defaults unknown status to TODO_PENDING", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Unknown", status: "blocked" }],
        }),
      );
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("defaults missing status to TODO_PENDING", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "No status field" }],
        }),
      );
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("handles mixed-case status via toLowerCase", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Mixed", status: "InProgress" }],
        }),
      );
      expect(todos["todo-0"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
    });
  });

  // ---------------------------------------------------------------------------
  // ID handling
  // ---------------------------------------------------------------------------

  describe("ID handling", () => {
    it("uses provided id when present", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ id: "my-id", content: "With ID", status: "pending" }],
        }),
      );
      expect(todos["my-id"]).toBeDefined();
      expect(todos["my-id"].id).toBe("my-id");
    });

    it("falls back to todo-{index} when id is absent", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [
            { content: "First", status: "pending" },
            { content: "Second", status: "completed" },
          ],
        }),
      );
      expect(todos["todo-0"]).toBeDefined();
      expect(todos["todo-0"].content).toBe("First");
      expect(todos["todo-1"]).toBeDefined();
      expect(todos["todo-1"].content).toBe("Second");
    });

    it("falls back to todo-{index} when id is empty string", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ id: "", content: "Empty ID", status: "pending" }],
        }),
      );
      expect(todos["todo-0"]).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot replace semantics (no merge / merge=false)
  // ---------------------------------------------------------------------------

  describe("snapshot replace (default)", () => {
    it("replaces all existing todos on each event", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Original", status: "pending" }],
        }),
      );
      expect(Object.keys(todos)).toHaveLength(1);

      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [
            { content: "Replacement A", status: "completed" },
            { content: "Replacement B", status: "pending" },
          ],
        }),
      );
      expect(Object.keys(todos)).toHaveLength(2);
      expect(todos["todo-0"].content).toBe("Replacement A");
      expect(todos["todo-1"].content).toBe("Replacement B");
    });

    it("clears todos when event has empty array and no merge", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Existing", status: "pending" }],
        }),
      );
      expect(Object.keys(todos)).toHaveLength(1);

      tracker.processEvent(
        todoToolCall("updateTodos", "completed", { todos: [] }),
      );
      expect(Object.keys(todos)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Merge semantics
  // ---------------------------------------------------------------------------

  describe("merge semantics", () => {
    it("preserves existing items when merge=true", () => {
      tracker.processEvent(
        todoToolCall("TodoWrite", "completed", {
          todos: [{ id: "t1", content: "Keep me", status: "pending" }],
        }),
      );

      tracker.processEvent(
        todoToolCall("TodoWrite", "completed", {
          todos: [{ id: "t2", content: "New one", status: "in_progress" }],
          merge: true,
        }),
      );

      expect(Object.keys(todos)).toHaveLength(2);
      expect(todos["t1"].content).toBe("Keep me");
      expect(todos["t2"].content).toBe("New one");
    });

    it("updates existing item by id on merge", () => {
      tracker.processEvent(
        todoToolCall("TodoWrite", "completed", {
          todos: [{ id: "t1", content: "Initial", status: "pending" }],
        }),
      );
      const originalCreatedAt = todos["t1"].createdAt;

      tracker.processEvent(
        todoToolCall("TodoWrite", "completed", {
          todos: [{ id: "t1", content: "Updated", status: "completed" }],
          merge: true,
        }),
      );

      expect(Object.keys(todos)).toHaveLength(1);
      expect(todos["t1"].content).toBe("Updated");
      expect(todos["t1"].status).toBe(TodoStatus.TODO_COMPLETED);
      expect(todos["t1"].createdAt).toBe(originalCreatedAt);
    });

    it("does not clear on empty array when merge=true", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Survivor", status: "pending" }],
        }),
      );

      tracker.processEvent(
        todoToolCall("updateTodos", "completed", { todos: [], merge: true }),
      );

      expect(Object.keys(todos)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Dirty flag lifecycle
  // ---------------------------------------------------------------------------

  describe("dirty flag", () => {
    it("starts clean", () => {
      expect(tracker.isDirty).toBe(false);
    });

    it("becomes dirty after processing a todo event", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Task", status: "pending" }],
        }),
      );
      expect(tracker.isDirty).toBe(true);
    });

    it("resets to clean after markPersisted()", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Task", status: "pending" }],
        }),
      );
      tracker.markPersisted();
      expect(tracker.isDirty).toBe(false);
    });

    it("stays clean when event is ignored", () => {
      tracker.processEvent(
        todoToolCall("Shell", "completed", {
          todos: [{ content: "Ignored", status: "pending" }],
        }),
      );
      expect(tracker.isDirty).toBe(false);
    });

    it("becomes dirty on empty-array clear (snapshot replace)", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Existing", status: "pending" }],
        }),
      );
      tracker.markPersisted();

      tracker.processEvent(
        todoToolCall("updateTodos", "completed", { todos: [] }),
      );
      expect(tracker.isDirty).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Args parsing
  // ---------------------------------------------------------------------------

  describe("args parsing", () => {
    it("handles args as a JSON string", () => {
      const argsStr = JSON.stringify({
        todos: [{ content: "From string", status: "pending" }],
      });
      tracker.processEvent(todoToolCall("updateTodos", "completed", argsStr));
      expect(todos["todo-0"].content).toBe("From string");
    });

    it("handles args as an object", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "From object", status: "completed" }],
        }),
      );
      expect(todos["todo-0"].content).toBe("From object");
    });

    it("handles null args gracefully", () => {
      tracker.processEvent(todoToolCall("updateTodos", "completed", null));
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("handles undefined args gracefully", () => {
      tracker.processEvent(todoToolCall("updateTodos", "completed", undefined));
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("handles malformed JSON string gracefully", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", "{broken json"),
      );
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Timestamps
  // ---------------------------------------------------------------------------

  describe("timestamps", () => {
    it("sets updatedAt on every item", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Timestamped", status: "pending" }],
        }),
      );
      expect(todos["todo-0"].updatedAt).toBeTruthy();
    });

    it("sets createdAt from args when provided", () => {
      tracker.processEvent(
        todoToolCall("TodoWrite", "completed", {
          todos: [
            {
              id: "t1",
              content: "With timestamp",
              status: "pending",
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
      );
      expect(todos["t1"].createdAt).toBe("2026-01-01T00:00:00Z");
    });

    it("generates createdAt when not in args", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [{ content: "Auto timestamp", status: "pending" }],
        }),
      );
      expect(todos["todo-0"].createdAt).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  describe("diagnostic logging", () => {
    it("logs when todos are processed", () => {
      tracker.processEvent(
        todoToolCall("updateTodos", "completed", {
          todos: [
            { content: "A", status: "pending" },
            { content: "B", status: "completed" },
          ],
        }),
      );
      expect(console.log).toHaveBeenCalledWith(
        "TodoTracker: processed 2 todo(s) from updateTodos (merge=false)",
      );
    });

    it("does not log when event is filtered out", () => {
      tracker.processEvent(
        todoToolCall("Shell", "completed", {
          todos: [{ content: "Ignored", status: "pending" }],
        }),
      );
      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
