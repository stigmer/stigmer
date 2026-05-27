/**
 * Unit tests for MessageAccumulator tool call status transitions.
 *
 * Validates the indexed tool call tracking that prevents the
 * cross-message lookup bug (FM-1) where completion events for slow
 * tools (especially MCP) would miss their target when interleaved
 * assistant text created new AI messages.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import { MessageAccumulator } from "../message-translator.js";

function toolCallEvent(
  callId: string,
  name: string,
  status: "running" | "completed" | "error",
  runId = "run-1",
  opts?: { result?: unknown; args?: unknown },
): Extract<SDKMessage, { type: "tool_call" }> {
  return {
    type: "tool_call",
    agent_id: "agent-1",
    run_id: runId,
    call_id: callId,
    name,
    status,
    result: opts?.result,
    args: opts?.args,
  };
}

function assistantEvent(
  runId: string,
  text: string,
): Extract<SDKMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    agent_id: "agent-1",
    run_id: runId,
    message: {
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
    },
  };
}

function countToolCallsWithId(messages: AgentMessage[], callId: string): number {
  let count = 0;
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.id === callId) count++;
    }
  }
  return count;
}

function findToolCallById(messages: AgentMessage[], callId: string) {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.id === callId) return tc;
    }
  }
  return undefined;
}

describe("MessageAccumulator tool call status transitions", () => {
  it("same-message completion: tool call status transitions on the same AI message", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    acc.processEvent(assistantEvent("r1", "Let me run a query."));
    acc.processEvent(toolCallEvent("tc-1", "Shell", "running"));
    acc.processEvent(toolCallEvent("tc-1", "Shell", "completed", "run-1", { result: "OK" }));

    expect(countToolCallsWithId(messages, "tc-1")).toBe(1);

    const tc = findToolCallById(messages, "tc-1")!;
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.result).toBe("OK");
    expect(tc.completedAt).toBeTruthy();
  });

  it("cross-message completion: tool call completes after new AI message is created", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    // AI message #1 with tool call
    acc.processEvent(assistantEvent("r1", "Running query..."));
    acc.processEvent(toolCallEvent("tc-1", "mcp", "running", "r1"));

    // New AI message #2 (different run_id)
    acc.processEvent(assistantEvent("r2", "Let me also check another thing."));

    // Tool call completes — must update the original on msg #1, not create duplicate on #2
    acc.processEvent(toolCallEvent("tc-1", "mcp", "completed", "r1", { result: "query result" }));

    expect(countToolCallsWithId(messages, "tc-1")).toBe(1);

    const tc = findToolCallById(messages, "tc-1")!;
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.result).toBe("query result");
  });

  it("multiple concurrent tools with interleaved text: both complete correctly", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    acc.processEvent(assistantEvent("r1", "Running two queries."));
    acc.processEvent(toolCallEvent("tc-1", "mcp", "running", "r1"));
    acc.processEvent(toolCallEvent("tc-2", "mcp", "running", "r1"));

    // Interleaved assistant text creates a new AI message
    acc.processEvent(assistantEvent("r2", "While those run, let me think..."));

    // Both complete after the new AI message
    acc.processEvent(toolCallEvent("tc-1", "mcp", "completed", "r1", { result: "result-1" }));
    acc.processEvent(toolCallEvent("tc-2", "mcp", "completed", "r1", { result: "result-2" }));

    expect(countToolCallsWithId(messages, "tc-1")).toBe(1);
    expect(countToolCallsWithId(messages, "tc-2")).toBe(1);

    const tc1 = findToolCallById(messages, "tc-1")!;
    const tc2 = findToolCallById(messages, "tc-2")!;
    expect(tc1.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc2.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc1.result).toBe("result-1");
    expect(tc2.result).toBe("result-2");
  });

  it("MCP tool with many interleaved assistant messages", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    acc.processEvent(assistantEvent("r1", "Starting SQL query."));
    acc.processEvent(toolCallEvent("tc-1", "mcp", "running", "r1", {
      args: { providerIdentifier: "postgres", toolName: "execute_sql", args: { query: "SELECT 1" } },
    }));

    // Three interleaved assistant messages (simulating slow MCP tool)
    acc.processEvent(assistantEvent("r2", "First update..."));
    acc.processEvent(assistantEvent("r3", "Second update..."));
    acc.processEvent(assistantEvent("r4", "Third update..."));

    // Tool finally completes
    acc.processEvent(toolCallEvent("tc-1", "mcp", "completed", "r1", { result: "rows: 1" }));

    expect(countToolCallsWithId(messages, "tc-1")).toBe(1);
    const tc = findToolCallById(messages, "tc-1")!;
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("unknown call_id on completion: creates new tool call gracefully", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    acc.processEvent(assistantEvent("r1", "Some context."));

    // Completion event without a preceding running event
    acc.processEvent(toolCallEvent("tc-orphan", "Shell", "completed", "r1", { result: "done" }));

    const tc = findToolCallById(messages, "tc-orphan")!;
    expect(tc).toBeDefined();
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("HITL denied tool: status transitions to FAILED", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    acc.processEvent(assistantEvent("r1", "About to run a dangerous tool."));
    acc.processEvent(toolCallEvent("tc-1", "mcp", "running", "r1"));
    acc.processEvent(toolCallEvent("tc-1", "mcp", "error", "r1", { result: "Tool denied by hook" }));

    const tc = findToolCallById(messages, "tc-1")!;
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(tc.error).toBe("Tool denied by hook");
  });

  it("finalize clears isStreaming on active AI messages", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    acc.processEvent(assistantEvent("r1", "Streaming text..."));

    const aiMsg = messages.find(m => m.type === MessageType.MESSAGE_AI);
    expect(aiMsg?.isStreaming).toBe(true);

    acc.finalize();
    expect(aiMsg?.isStreaming).toBe(false);
  });

  it("sub-agent tool calls are tracked via trackSubAgentExecution", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    acc.processEvent(assistantEvent("r1", "Delegating to sub-agent."));

    const runningEvent = toolCallEvent("tc-sub", "task", "running", "r1", {
      args: { subagentType: "generalPurpose", description: "Analyze data", prompt: "Do the thing" },
    });
    acc.processEvent(runningEvent);
    acc.trackSubAgentExecution(runningEvent);

    const completedEvent = toolCallEvent("tc-sub", "task", "completed", "r1", { result: "Done" });
    acc.processEvent(completedEvent);
    acc.trackSubAgentExecution(completedEvent);

    expect(acc.subAgentExecutions).toHaveLength(1);
    expect(acc.subAgentExecutions[0].id).toBe("tc-sub");
    expect(acc.subAgentExecutions[0].output).toBe("Done");
  });

  it("sub-agent name extraction handles object subagentType", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const event = toolCallEvent("tc-sub2", "task", "running", "r1", {
      args: { subagentType: { kind: "generalPurpose", name: "researcher" }, description: "Research", prompt: "Go" },
    });
    acc.processEvent(event);
    const sub = acc.trackSubAgentExecution(event);

    expect(sub).toBeDefined();
    expect(sub!.name).toBe("researcher");
  });

  it("sub-agent name extraction falls back to kind when name is absent", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const event = toolCallEvent("tc-sub3", "task", "running", "r1", {
      args: { subagentType: { kind: "explore" }, description: "Explore", prompt: "Go" },
    });
    acc.processEvent(event);
    const sub = acc.trackSubAgentExecution(event);

    expect(sub).toBeDefined();
    expect(sub!.name).toBe("explore");
  });

  describe("todo tool suppression", () => {
    it("updateTodos tool calls are excluded from messages", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("r1", "Planning..."));
      acc.processEvent(toolCallEvent("tc-todo", "updateTodos", "running", "r1", {
        args: { todos: [{ content: "Step 1", status: "pending" }] },
      }));
      acc.processEvent(toolCallEvent("tc-todo", "updateTodos", "completed", "r1"));

      const aiMsg = messages.find(m => m.type === MessageType.MESSAGE_AI);
      expect(aiMsg?.toolCalls).toHaveLength(0);
    });

    it("TodoWrite tool calls are excluded from messages", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("r1", "Planning..."));
      acc.processEvent(toolCallEvent("tc-tw", "TodoWrite", "running", "r1"));
      acc.processEvent(toolCallEvent("tc-tw", "TodoWrite", "completed", "r1"));

      const aiMsg = messages.find(m => m.type === MessageType.MESSAGE_AI);
      expect(aiMsg?.toolCalls).toHaveLength(0);
    });

    it("non-todo tool calls on the same AI message are preserved", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("r1", "Working..."));
      acc.processEvent(toolCallEvent("tc-shell", "Shell", "running", "r1", { args: { command: "ls" } }));
      acc.processEvent(toolCallEvent("tc-todo", "updateTodos", "running", "r1"));
      acc.processEvent(toolCallEvent("tc-shell", "Shell", "completed", "r1", { result: "file.txt" }));
      acc.processEvent(toolCallEvent("tc-todo", "updateTodos", "completed", "r1"));

      const aiMsg = messages.find(m => m.type === MessageType.MESSAGE_AI);
      expect(aiMsg?.toolCalls).toHaveLength(1);
      expect(aiMsg?.toolCalls[0].name).toBe("Shell");
    });
  });
});
