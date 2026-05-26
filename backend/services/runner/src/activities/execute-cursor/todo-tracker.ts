/**
 * Tracks todo tool call events from the Cursor SDK stream and populates
 * AgentExecutionStatus.todos with structured TodoItem protos.
 *
 * The Cursor SDK emits todo updates as tool_call events. Historically the
 * tool was named "TodoWrite"; current SDK versions use "updateTodos" with
 * a slightly different args schema (camelCase statuses, no per-item id).
 * This tracker accepts both names for resilience across SDK versions.
 *
 * The MessageAccumulator captures the same event as a MESSAGE_TOOL
 * (preserving visibility in the message thread). This tracker is a
 * parallel extraction into the proto map that downstream consumers
 * (React TodoList, CLI emitTodoEvents) already know how to render.
 *
 * Follows the same single-responsibility pattern as DeltaEnricher:
 * the orchestrator (execute-cursor.ts) wires it into the event loop.
 */

import { create } from "@bufbuild/protobuf";
import { TodoItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import { utcTimestamp } from "./message-translator.js";

const TODO_TOOL_NAMES = new Set(["TodoWrite", "updateTodos"]);

const STATUS_MAP: Record<string, TodoStatus> = {
  pending: TodoStatus.TODO_PENDING,
  in_progress: TodoStatus.TODO_IN_PROGRESS,
  inprogress: TodoStatus.TODO_IN_PROGRESS,
  completed: TodoStatus.TODO_COMPLETED,
  cancelled: TodoStatus.TODO_CANCELLED,
};

interface RawTodoItem {
  id?: string;
  content?: string;
  status?: string;
  created_at?: string;
}

export class TodoTracker {
  private readonly todos: { [key: string]: TodoItem };
  private _isDirty = false;

  constructor(todos: { [key: string]: TodoItem }) {
    this.todos = todos;
  }

  /**
   * Process a stream event. Only acts on completed todo tool calls
   * (both legacy "TodoWrite" and current SDK "updateTodos").
   */
  processEvent(event: SDKMessage): void {
    if (event.type !== "tool_call") return;
    if (!TODO_TOOL_NAMES.has(event.name)) return;
    if (event.status !== "completed") return;

    const args = this.parseArgs(event.args);
    if (!args) return;

    const rawTodos = args.todos as RawTodoItem[] | undefined;
    if (!Array.isArray(rawTodos) || rawTodos.length === 0) {
      if (args.merge !== true) {
        this.clearMap();
        this._isDirty = true;
      }
      return;
    }

    const merge = args.merge === true;
    const now = utcTimestamp();

    if (!merge) {
      this.clearMap();
    }

    for (let i = 0; i < rawTodos.length; i++) {
      const raw = rawTodos[i];
      const id = raw.id || `todo-${i}`;
      const statusStr = (raw.status ?? "pending").toLowerCase();
      const status = STATUS_MAP[statusStr] ?? TodoStatus.TODO_PENDING;

      const existing = merge ? this.todos[id] : undefined;

      this.todos[id] = create(TodoItemSchema, {
        id,
        content: raw.content ?? "",
        status,
        createdAt: existing?.createdAt || raw.created_at || now,
        updatedAt: now,
      });
    }

    this._isDirty = true;
    console.log(
      `TodoTracker: processed ${rawTodos.length} todo(s) from ${event.name} (merge=${merge})`,
    );
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  markPersisted(): void {
    this._isDirty = false;
  }

  private parseArgs(args: unknown): { todos?: unknown[]; merge?: boolean } | null {
    if (args == null) return null;

    if (typeof args === "string") {
      try {
        return JSON.parse(args);
      } catch {
        return null;
      }
    }

    if (typeof args === "object") {
      return args as { todos?: unknown[]; merge?: boolean };
    }

    return null;
  }

  private clearMap(): void {
    for (const key of Object.keys(this.todos)) {
      delete this.todos[key];
    }
  }
}
