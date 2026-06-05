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
  SubAgentStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SDKMessage } from "@cursor/sdk";
import {
  MessageAccumulator,
  extractConversationSteps,
  cancelInProgressSubAgentProtos,
} from "../message-translator.js";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";

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

  it("sub-agent is IN_PROGRESS on the task running event (live-visibility precondition)", () => {
    const acc = new MessageAccumulator([]);

    const runningEvent = toolCallEvent("tc-live", "task", "running", "r1", {
      args: { description: "Research topic", prompt: "Go" },
    });
    const sub = acc.trackSubAgentExecution(runningEvent);

    expect(sub).toBeDefined();
    expect(sub!.status).toBe(SubAgentStatus.SUB_AGENT_IN_PROGRESS);
    expect(acc.subAgentExecutions[0].status).toBe(SubAgentStatus.SUB_AGENT_IN_PROGRESS);
  });

  it("subAgentDirty starts false and is set when a sub-agent is created", () => {
    const acc = new MessageAccumulator([]);
    expect(acc.subAgentDirty).toBe(false);

    acc.trackSubAgentExecution(
      toolCallEvent("tc-dirty1", "task", "running", "r1", {
        args: { description: "Research", prompt: "Go" },
      }),
    );

    expect(acc.subAgentDirty).toBe(true);
  });

  it("markSubAgentPersisted clears the dirty flag, and an update re-marks it", () => {
    const acc = new MessageAccumulator([]);

    acc.trackSubAgentExecution(
      toolCallEvent("tc-dirty2", "task", "running", "r1", {
        args: { description: "Research", prompt: "Go" },
      }),
    );
    expect(acc.subAgentDirty).toBe(true);

    acc.markSubAgentPersisted();
    expect(acc.subAgentDirty).toBe(false);

    // The completion transition (IN_PROGRESS -> COMPLETED) must re-mark dirty
    // so the terminal sub-agent state is persisted to the live stream.
    acc.trackSubAgentExecution(
      toolCallEvent("tc-dirty2", "task", "completed", "r1", { result: "Done" }),
    );
    expect(acc.subAgentDirty).toBe(true);
    expect(acc.subAgentExecutions[0].status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
  });

  it("cancelInProgressSubAgents transitions IN_PROGRESS to CANCELLED and leaves terminal states untouched", () => {
    const acc = new MessageAccumulator([]);

    // Running sub-agent (should be cancelled).
    acc.trackSubAgentExecution(
      toolCallEvent("tc-run", "task", "running", "r1", {
        args: { description: "Long report", prompt: "Go" },
      }),
    );
    // Completed sub-agent (must stay COMPLETED).
    acc.trackSubAgentExecution(
      toolCallEvent("tc-done", "task", "running", "r1", {
        args: { description: "Quick lookup", prompt: "Go" },
      }),
    );
    acc.trackSubAgentExecution(
      toolCallEvent("tc-done", "task", "completed", "r1", { result: "Found it" }),
    );

    acc.markSubAgentPersisted();
    expect(acc.subAgentDirty).toBe(false);

    acc.cancelInProgressSubAgents();

    const running = acc.subAgentExecutions.find((s) => s.id === "tc-run")!;
    const done = acc.subAgentExecutions.find((s) => s.id === "tc-done")!;

    expect(running.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    expect(running.completedAt).not.toBe("");
    expect(done.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    // The transition must mark dirty so the cancellation is persisted.
    expect(acc.subAgentDirty).toBe(true);
  });

  it("cancelInProgressSubAgents is a no-op when there are no running sub-agents", () => {
    const acc = new MessageAccumulator([]);
    acc.cancelInProgressSubAgents();
    expect(acc.subAgentExecutions).toHaveLength(0);
    expect(acc.subAgentDirty).toBe(false);
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

  it("sub-agent name extraction falls back to description when kind is 'unspecified'", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const event = toolCallEvent("tc-sub4", "task", "running", "r1", {
      args: { subagentType: { kind: "unspecified" }, description: "Research renewable energy", prompt: "Go" },
    });
    acc.processEvent(event);
    const sub = acc.trackSubAgentExecution(event);

    expect(sub).toBeDefined();
    expect(sub!.name).toBe("Research renewable energy");
  });

  it("sub-agent name extraction falls back to description when subagentType is missing", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const event = toolCallEvent("tc-sub5", "task", "running", "r1", {
      args: { description: "Analyze codebase", prompt: "Go" },
    });
    acc.processEvent(event);
    const sub = acc.trackSubAgentExecution(event);

    expect(sub).toBeDefined();
    expect(sub!.name).toBe("Analyze codebase");
  });

  it("sub-agent extracts conversationSteps from task completed result", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const runningEvent = toolCallEvent("tc-sub6", "task", "running", "r1", {
      args: { subagentType: { kind: "unspecified" }, description: "Research topic", prompt: "Summarize AI" },
    });
    acc.processEvent(runningEvent);
    acc.trackSubAgentExecution(runningEvent);

    const completedEvent = toolCallEvent("tc-sub6", "task", "completed", "r1", {
      result: {
        status: "success",
        value: {
          conversationSteps: [
            { type: "thinkingMessage", message: { text: "Let me think about this..." } },
            { type: "assistantMessage", message: { text: "Here is a summary of AI." } },
          ],
          agentId: "sub-agent-123",
          durationMs: 5000,
          isBackground: false,
          backgroundReason: "unspecified",
        },
      },
    });
    acc.processEvent(completedEvent);
    acc.trackSubAgentExecution(completedEvent);

    const sub = acc.subAgentExecutions[0];
    expect(sub.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(sub.messages).toHaveLength(2);
    expect(sub.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
    expect(sub.messages[0].content).toBe("Let me think about this...");
    expect(sub.messages[1].type).toBe(MessageType.MESSAGE_AI);
    expect(sub.messages[1].content).toBe("Here is a summary of AI.");
  });

  it("sub-agent extracts toolCall steps from conversationSteps", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const runningEvent = toolCallEvent("tc-sub7", "task", "running", "r1", {
      args: { description: "Use tools", prompt: "Run ls" },
    });
    acc.processEvent(runningEvent);
    acc.trackSubAgentExecution(runningEvent);

    const completedEvent = toolCallEvent("tc-sub7", "task", "completed", "r1", {
      result: {
        status: "success",
        value: {
          conversationSteps: [
            {
              type: "toolCall",
              message: {
                type: "shell",
                args: { command: "ls -la" },
                result: { status: "success", value: { stdout: "file.txt", stderr: "", exitCode: 0 } },
              },
            },
            { type: "assistantMessage", message: { text: "I found file.txt." } },
          ],
          isBackground: false,
          backgroundReason: "unspecified",
        },
      },
    });
    acc.processEvent(completedEvent);
    acc.trackSubAgentExecution(completedEvent);

    const sub = acc.subAgentExecutions[0];
    expect(sub.messages).toHaveLength(2);

    const toolMsg = sub.messages[0];
    expect(toolMsg.type).toBe(MessageType.MESSAGE_AI);
    expect(toolMsg.toolCalls).toHaveLength(1);
    expect(toolMsg.toolCalls[0].name).toBe("shell");
    expect(toolMsg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);

    expect(sub.messages[1].type).toBe(MessageType.MESSAGE_AI);
    expect(sub.messages[1].content).toBe("I found file.txt.");
  });

  it("sub-agent gracefully handles missing conversationSteps", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const runningEvent = toolCallEvent("tc-sub8", "task", "running", "r1", {
      args: { description: "Quick task", prompt: "Do it" },
    });
    acc.processEvent(runningEvent);
    acc.trackSubAgentExecution(runningEvent);

    const completedEvent = toolCallEvent("tc-sub8", "task", "completed", "r1", {
      result: "Simple string result",
    });
    acc.processEvent(completedEvent);
    acc.trackSubAgentExecution(completedEvent);

    const sub = acc.subAgentExecutions[0];
    expect(sub.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(sub.output).toBe("Simple string result");
    expect(sub.messages).toHaveLength(0);
  });

  describe("extractConversationSteps standalone", () => {
    it("parses legacy format with thinkingMessage/assistantMessage keys (no type field)", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({
        status: "success",
        value: {
          conversationSteps: [
            { thinkingMessage: { text: "Hmm...", durationMs: 200 } },
            { assistantMessage: { text: "Answer." } },
          ],
        },
      }, out);

      expect(out).toHaveLength(2);
      expect(out[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(out[0].content).toBe("Hmm...");
      expect(out[1].type).toBe(MessageType.MESSAGE_AI);
      expect(out[1].content).toBe("Answer.");
    });

    it("skips unknown step types for forward compatibility", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({
        status: "success",
        value: {
          conversationSteps: [
            { type: "futureStepType", data: {} },
            { type: "assistantMessage", message: { text: "Still works." } },
          ],
        },
      }, out);

      expect(out).toHaveLength(1);
      expect(out[0].content).toBe("Still works.");
    });

    it("handles null/undefined/non-object result gracefully", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps(null, out);
      extractConversationSteps(undefined, out);
      extractConversationSteps("string", out);
      extractConversationSteps(42, out);
      expect(out).toHaveLength(0);
    });

    it("handles result without conversationSteps", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({ status: "success", value: {} }, out);
      expect(out).toHaveLength(0);
    });

    it("handles empty conversationSteps array", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({
        status: "success",
        value: { conversationSteps: [] },
      }, out);
      expect(out).toHaveLength(0);
    });

    it("skips steps with empty text", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({
        status: "success",
        value: {
          conversationSteps: [
            { type: "thinkingMessage", message: { text: "" } },
            { type: "assistantMessage", message: { text: "" } },
            { type: "assistantMessage", message: { text: "Real content." } },
          ],
        },
      }, out);

      expect(out).toHaveLength(1);
      expect(out[0].content).toBe("Real content.");
    });

    it("extracts tool error results correctly", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({
        status: "success",
        value: {
          conversationSteps: [
            {
              type: "toolCall",
              message: {
                type: "shell",
                args: { command: "bad-cmd" },
                result: { status: "error", error: "command not found" },
              },
            },
          ],
        },
      }, out);

      expect(out).toHaveLength(1);
      expect(out[0].toolCalls[0].result).toBe("command not found");
    });
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

  describe("cancelInProgressSubAgentProtos standalone", () => {
    it("cancels IN_PROGRESS/PENDING protos in place and reports whether anything changed", () => {
      const running = create(SubAgentExecutionSchema, {
        id: "a",
        status: SubAgentStatus.SUB_AGENT_IN_PROGRESS,
      });
      const pending = create(SubAgentExecutionSchema, {
        id: "b",
        status: SubAgentStatus.SUB_AGENT_PENDING,
      });
      const completed = create(SubAgentExecutionSchema, {
        id: "c",
        status: SubAgentStatus.SUB_AGENT_COMPLETED,
        completedAt: "2026-01-01T00:00:00Z",
      });

      const list = [running, pending, completed];
      const changed = cancelInProgressSubAgentProtos(list);

      expect(changed).toBe(true);
      expect(running.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
      expect(running.completedAt).not.toBe("");
      expect(pending.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
      // Terminal sub-agents are untouched.
      expect(completed.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
      expect(completed.completedAt).toBe("2026-01-01T00:00:00Z");
    });

    it("returns false when there is nothing to cancel", () => {
      const completed = create(SubAgentExecutionSchema, {
        id: "c",
        status: SubAgentStatus.SUB_AGENT_COMPLETED,
      });
      expect(cancelInProgressSubAgentProtos([completed])).toBe(false);
      expect(cancelInProgressSubAgentProtos([])).toBe(false);
    });
  });
});
