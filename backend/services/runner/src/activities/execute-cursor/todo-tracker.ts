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
 * The payload-to-map mapping lives in the harness-agnostic `applyTodoUpdate`
 * (shared/todos.ts), shared with the native v2/v3 status builders so no two
 * writers of `status.todos` can drift. This class owns only the Cursor-specific
 * concerns: which events carry todos, parsing the SDK's args shape, and the
 * dirty/force-flush signal.
 *
 * Follows the same single-responsibility pattern as DeltaEnricher:
 * the orchestrator (execute-cursor.ts) wires it into the event loop.
 */

import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import type { SDKMessage } from "@cursor/sdk";
import { applyTodoUpdate } from "../../shared/todos.js";

const TODO_TOOL_NAMES = new Set(["TodoWrite", "updateTodos"]);

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

    const changed = applyTodoUpdate(this.todos, args.todos, {
      merge: args.merge === true,
    });
    if (changed) {
      this._isDirty = true;
    }

    if (Array.isArray(args.todos) && args.todos.length > 0) {
      console.log(
        `TodoTracker: processed ${args.todos.length} todo(s) from ${event.name} ` +
        `(merge=${args.merge === true})`,
      );
    }
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
}
