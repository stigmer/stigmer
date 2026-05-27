/**
 * Unit tests for CursorSubAgentRouter — validates agent_id-based event
 * routing for sub-agent message accumulation and todo scoping.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { SubAgentStatus, MessageType, TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import { CursorSubAgentRouter } from "../subagent-router.js";

function assistantEvent(agentId: string, runId: string, text: string): SDKMessage {
  return {
    type: "assistant",
    agent_id: agentId,
    run_id: runId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

function thinkingEvent(agentId: string, runId: string, text: string): SDKMessage {
  return {
    type: "thinking",
    agent_id: agentId,
    run_id: runId,
    text,
  };
}

function toolCallEvent(
  agentId: string,
  runId: string,
  name: string,
  callId: string,
  status: "running" | "completed" | "error",
  args?: unknown,
  result?: unknown,
): Extract<SDKMessage, { type: "tool_call" }> {
  return {
    type: "tool_call",
    agent_id: agentId,
    run_id: runId,
    call_id: callId,
    name,
    status,
    args,
    result,
  };
}

function todoToolCall(
  agentId: string,
  runId: string,
  callId: string,
  status: "running" | "completed",
  args?: unknown,
): Extract<SDKMessage, { type: "tool_call" }> {
  return toolCallEvent(agentId, runId, "updateTodos", callId, status, args);
}

function makeSubAgent(callId: string): import("@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb").SubAgentExecution {
  return create(SubAgentExecutionSchema, {
    id: callId,
    name: "researcher",
    subject: "Research topic",
    input: "Investigate this",
    status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
    startedAt: new Date().toISOString(),
    todos: {},
  });
}

describe("CursorSubAgentRouter", () => {
  let router: CursorSubAgentRouter;

  beforeEach(() => {
    router = new CursorSubAgentRouter();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("parent agent_id registration", () => {
    it("captures parent agent_id from the first event", () => {
      const event = assistantEvent("parent-1", "r1", "Hello");
      expect(router.isSubAgentEvent(event)).toBe(false);
      expect(router.isSubAgentEvent(assistantEvent("parent-1", "r2", "World"))).toBe(false);
    });

    it("recognizes events from a different agent_id after registration", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      expect(router.isSubAgentEvent(assistantEvent("child-1", "r2", "Sub text"))).toBe(true);
    });

    it("treats events with parent agent_id as parent events", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      expect(router.isSubAgentEvent(assistantEvent("parent-1", "r3", "Still parent"))).toBe(false);
    });
  });

  describe("sub-agent routing", () => {
    it("routes events with sub-agent agent_id to SubAgentExecution.messages", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      router.routeEvent(assistantEvent("child-1", "r2", "Found results"));
      router.syncToProto();

      expect(sub.messages).toHaveLength(1);
      expect(sub.messages[0].type).toBe(MessageType.MESSAGE_AI);
      expect(sub.messages[0].content).toBe("Found results");
    });

    it("accumulates multiple messages for a sub-agent", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      router.routeEvent(thinkingEvent("child-1", "r2", "Analyzing..."));
      router.routeEvent(assistantEvent("child-1", "r3", "Here are findings"));
      router.syncToProto();

      expect(sub.messages).toHaveLength(2);
      expect(sub.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(sub.messages[1].type).toBe(MessageType.MESSAGE_AI);
    });

    it("routes tool calls inside sub-agent to sub-agent messages", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      router.routeEvent(assistantEvent("child-1", "r2", "Running tool"));
      router.routeEvent(toolCallEvent("child-1", "r2", "Shell", "tc-1", "running", { command: "ls" }));
      router.routeEvent(toolCallEvent("child-1", "r2", "Shell", "tc-1", "completed", undefined, "file1.txt"));
      router.syncToProto();

      expect(sub.messages.length).toBeGreaterThanOrEqual(1);
      const aiMsg = sub.messages.find(m => m.type === MessageType.MESSAGE_AI);
      expect(aiMsg?.toolCalls).toHaveLength(1);
      expect(aiMsg?.toolCalls[0].name).toBe("Shell");
    });
  });

  describe("multiple concurrent sub-agents", () => {
    it("routes to correct sub-agent based on agent_id", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub1 = makeSubAgent("task-1");
      const sub2 = makeSubAgent("task-2");
      router.registerSubAgent("task-1", sub1);
      router.registerSubAgent("task-2", sub2);

      router.routeEvent(assistantEvent("child-a", "r2", "From sub-1"));
      router.routeEvent(assistantEvent("child-b", "r3", "From sub-2"));
      router.syncToProto();

      expect(sub1.messages).toHaveLength(1);
      expect(sub1.messages[0].content).toBe("From sub-1");
      expect(sub2.messages).toHaveLength(1);
      expect(sub2.messages[0].content).toBe("From sub-2");
    });
  });

  describe("unknown agent_id fallback", () => {
    it("returns false for unknown agent_id when no pending registrations", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));
      expect(router.isSubAgentEvent(assistantEvent("mystery-1", "r2", "Who am I?"))).toBe(false);
    });

    it("silently drops events for unknown agent_id with no pending registrations", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));
      router.routeEvent(assistantEvent("mystery-1", "r2", "Dropped"));
      expect(router.isDirty).toBe(false);
    });
  });

  describe("finalization", () => {
    it("finalizeSubAgent marks messages as not streaming", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      router.routeEvent(assistantEvent("child-1", "r2", "Working..."));
      router.finalizeSubAgent("task-1");

      expect(sub.messages).toHaveLength(1);
      expect(sub.messages[0].isStreaming).toBe(false);
    });
  });

  describe("scoped todo tracking", () => {
    it("routes sub-agent updateTodos to SubAgentExecution.todos", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      router.routeEvent(todoToolCall("child-1", "r2", "todo-tc-1", "completed", {
        todos: [{ content: "Sub-agent task A", status: "pending" }],
      }));
      router.syncToProto();

      expect(Object.keys(sub.todos)).toHaveLength(1);
      expect(sub.todos["todo-0"].content).toBe("Sub-agent task A");
      expect(sub.todos["todo-0"].status).toBe(TodoStatus.TODO_PENDING);
    });

    it("does not affect parent todos when sub-agent updates its own", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      router.routeEvent(todoToolCall("child-1", "r2", "todo-tc-1", "completed", {
        todos: [{ content: "Sub task", status: "in_progress" }],
      }));
      router.syncToProto();

      expect(Object.keys(sub.todos)).toHaveLength(1);
    });
  });

  describe("dirty flag", () => {
    it("starts clean", () => {
      expect(router.isDirty).toBe(false);
    });

    it("becomes dirty when a sub-agent event is routed", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      router.routeEvent(assistantEvent("child-1", "r2", "Hello"));
      expect(router.isDirty).toBe(true);
    });

    it("resets on markPersisted", () => {
      router.isSubAgentEvent(assistantEvent("parent-1", "r1", "Init"));

      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);

      router.routeEvent(assistantEvent("child-1", "r2", "Hello"));
      router.markPersisted();
      expect(router.isDirty).toBe(false);
    });
  });

  describe("hasSubAgents", () => {
    it("returns false when no sub-agents registered", () => {
      expect(router.hasSubAgents()).toBe(false);
    });

    it("returns true after registration", () => {
      const sub = makeSubAgent("task-1");
      router.registerSubAgent("task-1", sub);
      expect(router.hasSubAgents()).toBe(true);
    });
  });
});
