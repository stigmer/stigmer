import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { TodoItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import { TodoTracker } from "../todo-tracker.js";

function todoWriteEvent(
  args: unknown,
  status: string = "completed",
  callId: string = "tc-todo-1",
): SDKMessage {
  return {
    type: "tool_call",
    call_id: callId,
    name: "TodoWrite",
    status,
    args,
    result: null,
    run_id: "run-1",
  } as SDKMessage;
}

function otherToolCallEvent(name: string = "Shell"): SDKMessage {
  return {
    type: "tool_call",
    call_id: "tc-other-1",
    name,
    status: "completed",
    args: { command: "ls" },
    result: "output",
    run_id: "run-1",
  } as SDKMessage;
}

function assistantEvent(): SDKMessage {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text: "Hello" }] },
    run_id: "run-1",
  } as SDKMessage;
}

describe("TodoTracker", () => {
  let todos: { [key: string]: TodoItem };
  let tracker: TodoTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:00.000Z"));
    todos = {};
    tracker = new TodoTracker(todos);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("snapshot replace (merge: false or absent)", () => {
    it("populates todos from a TodoWrite event", () => {
      const event = todoWriteEvent({
        todos: [
          { id: "t1", content: "Build feature", status: "in_progress" },
          { id: "t2", content: "Write tests", status: "pending" },
        ],
      });

      tracker.processEvent(event);

      expect(Object.keys(todos)).toHaveLength(2);
      expect(todos["t1"].content).toBe("Build feature");
      expect(todos["t1"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
      expect(todos["t2"].content).toBe("Write tests");
      expect(todos["t2"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("replaces existing todos when merge is false", () => {
      todos["old"] = create(TodoItemSchema, {
        id: "old",
        content: "Old task",
        status: TodoStatus.TODO_COMPLETED,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      });

      const event = todoWriteEvent({
        todos: [{ id: "new", content: "New task", status: "pending" }],
        merge: false,
      });

      tracker.processEvent(event);

      expect(todos["old"]).toBeUndefined();
      expect(Object.keys(todos)).toHaveLength(1);
      expect(todos["new"].content).toBe("New task");
    });

    it("replaces existing todos when merge is absent", () => {
      todos["existing"] = create(TodoItemSchema, {
        id: "existing",
        content: "Existing",
        status: TodoStatus.TODO_PENDING,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      });

      const event = todoWriteEvent({
        todos: [{ id: "replacement", content: "Replacement", status: "completed" }],
      });

      tracker.processEvent(event);

      expect(todos["existing"]).toBeUndefined();
      expect(todos["replacement"].content).toBe("Replacement");
      expect(todos["replacement"].status).toBe(TodoStatus.TODO_COMPLETED);
    });

    it("clears all todos when todos array is empty and merge is false", () => {
      todos["t1"] = create(TodoItemSchema, {
        id: "t1",
        content: "Task",
        status: TodoStatus.TODO_PENDING,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      });

      tracker.processEvent(todoWriteEvent({ todos: [], merge: false }));

      expect(Object.keys(todos)).toHaveLength(0);
    });
  });

  describe("merge update (merge: true)", () => {
    it("preserves existing todos and adds new ones", () => {
      todos["t1"] = create(TodoItemSchema, {
        id: "t1",
        content: "Existing task",
        status: TodoStatus.TODO_IN_PROGRESS,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T11:00:00.000Z",
      });

      const event = todoWriteEvent({
        todos: [
          { id: "t1", content: "Existing task", status: "completed" },
          { id: "t2", content: "New task", status: "pending" },
        ],
        merge: true,
      });

      tracker.processEvent(event);

      expect(Object.keys(todos)).toHaveLength(2);
      expect(todos["t1"].status).toBe(TodoStatus.TODO_COMPLETED);
      expect(todos["t1"].createdAt).toBe("2026-05-01T10:00:00.000Z");
      expect(todos["t1"].updatedAt).toBe("2026-05-02T12:00:00.000Z");
      expect(todos["t2"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("does not remove existing todos not in the update", () => {
      todos["t1"] = create(TodoItemSchema, {
        id: "t1",
        content: "Unchanged",
        status: TodoStatus.TODO_PENDING,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      });

      const event = todoWriteEvent({
        todos: [{ id: "t2", content: "Added", status: "in_progress" }],
        merge: true,
      });

      tracker.processEvent(event);

      expect(todos["t1"].content).toBe("Unchanged");
      expect(todos["t2"].content).toBe("Added");
    });

    it("is a no-op when todos array is empty and merge is true", () => {
      todos["t1"] = create(TodoItemSchema, {
        id: "t1",
        content: "Preserved",
        status: TodoStatus.TODO_PENDING,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      });

      tracker.processEvent(todoWriteEvent({ todos: [], merge: true }));

      expect(todos["t1"].content).toBe("Preserved");
    });
  });

  describe("status mapping", () => {
    it("maps all four status strings correctly", () => {
      const event = todoWriteEvent({
        todos: [
          { id: "t1", content: "Pending", status: "pending" },
          { id: "t2", content: "In progress", status: "in_progress" },
          { id: "t3", content: "Completed", status: "completed" },
          { id: "t4", content: "Cancelled", status: "cancelled" },
        ],
      });

      tracker.processEvent(event);

      expect(todos["t1"].status).toBe(TodoStatus.TODO_PENDING);
      expect(todos["t2"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
      expect(todos["t3"].status).toBe(TodoStatus.TODO_COMPLETED);
      expect(todos["t4"].status).toBe(TodoStatus.TODO_CANCELLED);
    });

    it("defaults unknown status to TODO_PENDING", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "t1", content: "Unknown", status: "invalid_status" }],
      }));

      expect(todos["t1"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("handles uppercase status by lowercasing", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "t1", content: "Upper", status: "IN_PROGRESS" }],
      }));

      expect(todos["t1"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
    });

    it("defaults missing status to TODO_PENDING", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "t1", content: "No status" }],
      }));

      expect(todos["t1"].status).toBe(TodoStatus.TODO_PENDING);
    });
  });

  describe("args parsing", () => {
    it("parses string args (JSON)", () => {
      const event = todoWriteEvent(
        JSON.stringify({
          todos: [{ id: "t1", content: "From string", status: "pending" }],
        }),
      );

      tracker.processEvent(event);

      expect(todos["t1"].content).toBe("From string");
    });

    it("handles object args directly", () => {
      const event = todoWriteEvent({
        todos: [{ id: "t1", content: "From object", status: "completed" }],
      });

      tracker.processEvent(event);

      expect(todos["t1"].content).toBe("From object");
    });

    it("ignores null args", () => {
      tracker.processEvent(todoWriteEvent(null));
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("ignores undefined args", () => {
      tracker.processEvent(todoWriteEvent(undefined));
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("ignores malformed JSON string args", () => {
      tracker.processEvent(todoWriteEvent("{invalid json"));
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("ignores args without todos array", () => {
      tracker.processEvent(todoWriteEvent({ someOtherField: "value" }));
      expect(Object.keys(todos)).toHaveLength(0);
    });
  });

  describe("event filtering", () => {
    it("ignores non-tool_call events", () => {
      tracker.processEvent(assistantEvent());
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("ignores tool calls that are not TodoWrite", () => {
      tracker.processEvent(otherToolCallEvent("Shell"));
      tracker.processEvent(otherToolCallEvent("Read"));
      tracker.processEvent(otherToolCallEvent("Grep"));
      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("ignores TodoWrite with status 'running'", () => {
      const event = todoWriteEvent(
        { todos: [{ id: "t1", content: "Task", status: "pending" }] },
        "running",
      );

      tracker.processEvent(event);

      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });

    it("ignores TodoWrite with status 'error'", () => {
      const event = todoWriteEvent(
        { todos: [{ id: "t1", content: "Task", status: "pending" }] },
        "error",
      );

      tracker.processEvent(event);

      expect(Object.keys(todos)).toHaveLength(0);
      expect(tracker.isDirty).toBe(false);
    });
  });

  describe("dirty flag", () => {
    it("is not dirty initially", () => {
      expect(tracker.isDirty).toBe(false);
    });

    it("becomes dirty after processing a TodoWrite", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "t1", content: "Task", status: "pending" }],
      }));

      expect(tracker.isDirty).toBe(true);
    });

    it("is cleared by markPersisted", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "t1", content: "Task", status: "pending" }],
      }));
      tracker.markPersisted();

      expect(tracker.isDirty).toBe(false);
    });

    it("is not set when event is ignored", () => {
      tracker.processEvent(otherToolCallEvent());
      expect(tracker.isDirty).toBe(false);
    });

    it("is set when snapshot replace clears an empty list", () => {
      todos["t1"] = create(TodoItemSchema, {
        id: "t1",
        content: "Existing",
        status: TodoStatus.TODO_PENDING,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      });

      tracker.processEvent(todoWriteEvent({ todos: [], merge: false }));
      expect(tracker.isDirty).toBe(true);
    });
  });

  describe("timestamps", () => {
    it("sets created_at and updated_at to now on snapshot replace", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "t1", content: "Task", status: "pending" }],
      }));

      expect(todos["t1"].createdAt).toBe("2026-05-02T12:00:00.000Z");
      expect(todos["t1"].updatedAt).toBe("2026-05-02T12:00:00.000Z");
    });

    it("preserves original created_at from args on replace", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "t1", content: "Task", status: "pending", created_at: "2026-04-01T08:00:00.000Z" }],
      }));

      expect(todos["t1"].createdAt).toBe("2026-04-01T08:00:00.000Z");
      expect(todos["t1"].updatedAt).toBe("2026-05-02T12:00:00.000Z");
    });

    it("preserves existing created_at on merge update", () => {
      todos["t1"] = create(TodoItemSchema, {
        id: "t1",
        content: "Original",
        status: TodoStatus.TODO_PENDING,
        createdAt: "2026-04-15T09:00:00.000Z",
        updatedAt: "2026-04-15T09:00:00.000Z",
      });

      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "t1", content: "Updated", status: "completed" }],
        merge: true,
      }));

      expect(todos["t1"].createdAt).toBe("2026-04-15T09:00:00.000Z");
      expect(todos["t1"].updatedAt).toBe("2026-05-02T12:00:00.000Z");
    });
  });

  describe("ID fallback", () => {
    it("assigns todo-{index} when id is missing", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [
          { content: "First", status: "pending" },
          { content: "Second", status: "in_progress" },
        ],
      }));

      expect(todos["todo-0"].content).toBe("First");
      expect(todos["todo-1"].content).toBe("Second");
    });

    it("assigns todo-{index} when id is empty string", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [{ id: "", content: "Empty ID", status: "pending" }],
      }));

      expect(todos["todo-0"].content).toBe("Empty ID");
    });
  });

  describe("multiple sequential events", () => {
    it("handles multiple TodoWrite events in sequence", () => {
      tracker.processEvent(todoWriteEvent({
        todos: [
          { id: "t1", content: "Task 1", status: "in_progress" },
          { id: "t2", content: "Task 2", status: "pending" },
        ],
      }));

      expect(Object.keys(todos)).toHaveLength(2);

      tracker.processEvent(todoWriteEvent({
        todos: [
          { id: "t1", content: "Task 1", status: "completed" },
          { id: "t2", content: "Task 2", status: "in_progress" },
          { id: "t3", content: "Task 3", status: "pending" },
        ],
      }, "completed", "tc-todo-2"));

      expect(Object.keys(todos)).toHaveLength(3);
      expect(todos["t1"].status).toBe(TodoStatus.TODO_COMPLETED);
      expect(todos["t2"].status).toBe(TodoStatus.TODO_IN_PROGRESS);
      expect(todos["t3"].status).toBe(TodoStatus.TODO_PENDING);
    });
  });
});
