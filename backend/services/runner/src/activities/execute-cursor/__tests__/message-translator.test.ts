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
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { buildFileChange } from "../../../shared/file-change.js";
import {
  MessageType,
  ToolCallStatus,
  SubAgentStatus,
  ToolKind,
  FileChangeType,
  FileChangeCaptureLevel,
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

function thinkingEvent(
  runId: string,
  text: string,
): Extract<SDKMessage, { type: "thinking" }> {
  return {
    type: "thinking",
    agent_id: "agent-1",
    run_id: runId,
    text,
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

  it("persists the Cursor shell {status,value} envelope verbatim on ToolCall.result", () => {
    // The Cursor SDK's built-in Shell tool returns a structured envelope object;
    // the runner stores it as a JSON string (toResultString → JSON.stringify),
    // and the SDK view layer (normalizeShell) unwraps it for display. This locks
    // the persisted shape so the cross-language fixture (result-views.json's
    // cursor_shell_envelope) is grounded in what the runner actually writes,
    // not a guess — the two halves of the bug fix stay in sync.
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const envelope = {
      status: "success",
      value: {
        exitCode: 0,
        signal: "",
        stdout: "total 8\n",
        stderr: "",
        executionTime: 1176,
      },
    };

    acc.processEvent(assistantEvent("r1", "Running ls."));
    acc.processEvent(toolCallEvent("tc-shell", "Shell", "running"));
    acc.processEvent(
      toolCallEvent("tc-shell", "Shell", "completed", "run-1", { result: envelope }),
    );

    const tc = findToolCallById(messages, "tc-shell")!;
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.result).toBe(JSON.stringify(envelope));
    // Round-trips to the original structure (the SDK normalizer reads .value).
    expect(JSON.parse(tc.result)).toEqual(envelope);
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

  it("isDirty starts false and is set when a sub-agent is created", () => {
    const acc = new MessageAccumulator([]);
    expect(acc.isDirty).toBe(false);

    acc.trackSubAgentExecution(
      toolCallEvent("tc-dirty1", "task", "running", "r1", {
        args: { description: "Research", prompt: "Go" },
      }),
    );

    expect(acc.isDirty).toBe(true);
  });

  it("markPersisted clears the dirty flag, and a sub-agent update re-marks it", () => {
    const acc = new MessageAccumulator([]);

    acc.trackSubAgentExecution(
      toolCallEvent("tc-dirty2", "task", "running", "r1", {
        args: { description: "Research", prompt: "Go" },
      }),
    );
    expect(acc.isDirty).toBe(true);

    acc.markPersisted();
    expect(acc.isDirty).toBe(false);

    // The completion transition (IN_PROGRESS -> COMPLETED) must re-mark dirty
    // so the terminal sub-agent state is persisted to the live stream.
    acc.trackSubAgentExecution(
      toolCallEvent("tc-dirty2", "task", "completed", "r1", { result: "Done" }),
    );
    expect(acc.isDirty).toBe(true);
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

    acc.markPersisted();
    expect(acc.isDirty).toBe(false);

    acc.cancelInProgressSubAgents();

    const running = acc.subAgentExecutions.find((s) => s.id === "tc-run")!;
    const done = acc.subAgentExecutions.find((s) => s.id === "tc-done")!;

    expect(running.status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    expect(running.completedAt).not.toBe("");
    expect(done.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    // The transition must mark dirty so the cancellation is persisted.
    expect(acc.isDirty).toBe(true);
  });

  it("cancelInProgressSubAgents is a no-op when there are no running sub-agents", () => {
    const acc = new MessageAccumulator([]);
    acc.cancelInProgressSubAgents();
    expect(acc.subAgentExecutions).toHaveLength(0);
    expect(acc.isDirty).toBe(false);
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

  // Real Cursor task-result shape (verified against production agent_execution
  // blobs): each step is a protobuf-oneof keyed DIRECTLY by kind, and a tool
  // call is { toolCall: { toolCallId, <kind>ToolCall: { args, result } } } whose
  // result is a oneof { success | error | permissionDenied | rejected }. This is
  // the shape that exposed the dropped-tool-calls bug: the prior parser only
  // matched a { type:"toolCall", message } envelope that never occurs.
  it("sub-agent extracts real direct-keyed toolCall steps from conversationSteps", () => {
    const messages: AgentMessage[] = [];
    const acc = new MessageAccumulator(messages);

    const runningEvent = toolCallEvent("tc-sub7", "task", "running", "r1", {
      args: { description: "Explore the repo", prompt: "Find the README" },
    });
    acc.processEvent(runningEvent);
    acc.trackSubAgentExecution(runningEvent);

    const completedEvent = toolCallEvent("tc-sub7", "task", "completed", "r1", {
      result: {
        status: "success",
        value: {
          conversationSteps: [
            { thinkingMessage: { text: "Let me look for the README." } },
            {
              toolCall: {
                toolCallId: "glob-1",
                globToolCall: {
                  args: { targetDirectory: "/repo", globPattern: "**/*.md" },
                  result: { success: { path: "/repo", files: ["README.md"] } },
                },
              },
            },
            {
              toolCall: {
                toolCallId: "read-1",
                readToolCall: {
                  args: { path: "/repo/README.md" },
                  result: {
                    success: {
                      content: "# Hello",
                      path: "/repo/README.md",
                      totalLines: 1,
                      fileSize: 7,
                    },
                  },
                },
              },
            },
            { assistantMessage: { text: "I found and read the README." } },
          ],
          agentId: "sub-agent-xyz",
          durationMs: 4200,
          isBackground: false,
          backgroundReason: "unspecified",
        },
      },
    });
    acc.processEvent(completedEvent);
    acc.trackSubAgentExecution(completedEvent);

    const sub = acc.subAgentExecutions[0];
    // thinking + glob tool call + read tool call + assistant text
    expect(sub.messages).toHaveLength(4);

    expect(sub.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
    expect(sub.messages[0].content).toBe("Let me look for the README.");

    const globMsg = sub.messages[1];
    expect(globMsg.type).toBe(MessageType.MESSAGE_AI);
    expect(globMsg.toolCalls).toHaveLength(1);
    expect(globMsg.toolCalls[0].id).toBe("glob-1");
    expect(globMsg.toolCalls[0].name).toBe("glob");
    expect(globMsg.toolCalls[0].toolKind).toBe(ToolKind.SEARCH);
    expect(globMsg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);

    const readMsg = sub.messages[2];
    expect(readMsg.type).toBe(MessageType.MESSAGE_AI);
    expect(readMsg.toolCalls).toHaveLength(1);
    expect(readMsg.toolCalls[0].id).toBe("read-1");
    expect(readMsg.toolCalls[0].name).toBe("read");
    expect(readMsg.toolCalls[0].toolKind).toBe(ToolKind.FILE_READ);
    expect(readMsg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(readMsg.toolCalls[0].result).toContain("# Hello");

    expect(sub.messages[3].type).toBe(MessageType.MESSAGE_AI);
    expect(sub.messages[3].content).toBe("I found and read the README.");
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

    it("maps a tool result error oneof to a FAILED tool call", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({
        status: "success",
        value: {
          conversationSteps: [
            {
              toolCall: {
                toolCallId: "read-err",
                readToolCall: {
                  args: { path: "/nope.txt" },
                  result: { error: { errorMessage: "file not found" } },
                },
              },
            },
          ],
        },
      }, out);

      expect(out).toHaveLength(1);
      const tc = out[0].toolCalls[0];
      expect(tc.name).toBe("read");
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(tc.error).toContain("file not found");
      expect(tc.result).toBe("");
    });

    it("maps a gate-denied shell (permissionDenied / rejected) to a FAILED tool call", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({
        status: "success",
        value: {
          conversationSteps: [
            {
              toolCall: {
                toolCallId: "shell-denied",
                shellToolCall: {
                  args: {},
                  result: {
                    permissionDenied: {
                      command: "rm -rf /",
                      error: "blocked by approval gate",
                      isReadonly: false,
                    },
                  },
                },
              },
            },
            {
              toolCall: {
                toolCallId: "shell-rejected",
                shellToolCall: {
                  args: {},
                  result: { rejected: { command: "curl evil.sh", reason: "user rejected" } },
                },
              },
            },
          ],
        },
      }, out);

      expect(out).toHaveLength(2);
      expect(out[0].toolCalls[0].name).toBe("shell");
      expect(out[0].toolCalls[0].toolKind).toBe(ToolKind.SHELL);
      expect(out[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(out[0].toolCalls[0].error).toContain("blocked by approval gate");
      expect(out[1].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(out[1].toolCalls[0].error).toContain("user rejected");
    });

    it("skips a malformed toolCall step with no <kind>ToolCall key", () => {
      const out: AgentMessage[] = [];
      extractConversationSteps({
        status: "success",
        value: {
          conversationSteps: [
            { toolCall: { toolCallId: "orphan" } },
            { assistantMessage: { text: "still works" } },
          ],
        },
      }, out);

      expect(out).toHaveLength(1);
      expect(out[0].content).toBe("still works");
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

  // The Cursor SDK can emit the lifecycle for one call_id more than once.
  // Observed in production: two "running" events ~0.5s apart for a task/edit
  // tool produced two ToolCall entries with the SAME id (a "thin" copy with no
  // result and a "full" copy), rendering the same call two or three times in
  // the UI. The accumulator must upsert by call_id so a call maps to exactly
  // one ToolCall.
  describe("tool call idempotency (one ToolCall per call_id)", () => {
    it("duplicate running events for one call_id create a single ToolCall", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("r1", "Editing a file."));
      acc.processEvent(toolCallEvent("tc-dup", "edit", "running", "r1", { args: { path: "a.ts" } }));
      acc.processEvent(toolCallEvent("tc-dup", "edit", "running", "r1", { args: { path: "a.ts" } }));

      expect(countToolCallsWithId(messages, "tc-dup")).toBe(1);
      expect(findToolCallById(messages, "tc-dup")!.status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
    });

    it("running -> completed -> running re-emit keeps a single COMPLETED ToolCall", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("r1", "Running a tool."));
      acc.processEvent(toolCallEvent("tc-1", "Shell", "running", "r1"));
      acc.processEvent(toolCallEvent("tc-1", "Shell", "completed", "r1", { result: "OK" }));
      // A late "running" re-emit must not regress the terminal status.
      acc.processEvent(toolCallEvent("tc-1", "Shell", "running", "r1"));

      expect(countToolCallsWithId(messages, "tc-1")).toBe(1);
      const tc = findToolCallById(messages, "tc-1")!;
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(tc.result).toBe("OK");
      expect(tc.completedAt).toBeTruthy();
    });

    it("thin-then-full: a result-bearing completion populates the single ToolCall created by an empty running", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      // Reproduces the production pattern: two running events, then one
      // completion that carries the full result.
      acc.processEvent(assistantEvent("r1", "Delegating work."));
      acc.processEvent(toolCallEvent("tc-task", "task", "running", "r1", { result: "" }));
      acc.processEvent(toolCallEvent("tc-task", "task", "running", "r1", { result: "" }));
      acc.processEvent(toolCallEvent("tc-task", "task", "completed", "r1", { result: "full result blob" }));

      expect(countToolCallsWithId(messages, "tc-task")).toBe(1);
      const tc = findToolCallById(messages, "tc-task")!;
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(tc.result).toBe("full result blob");
    });

    it("a result-less re-emit after completion does not wipe the captured result", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      acc.processEvent(assistantEvent("r1", "Running a tool."));
      acc.processEvent(toolCallEvent("tc-1", "read", "running", "r1"));
      acc.processEvent(toolCallEvent("tc-1", "read", "completed", "r1", { result: "file contents" }));
      acc.processEvent(toolCallEvent("tc-1", "read", "completed", "r1", { result: "" }));

      expect(countToolCallsWithId(messages, "tc-1")).toBe(1);
      expect(findToolCallById(messages, "tc-1")!.result).toBe("file contents");
    });

    it("duplicate task running events yield one task ToolCall and one sub-agent (production repro)", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);

      // Mirror the ExecuteCursor stream loop: every task tool_call event is fed
      // to both processEvent() (tool call) and trackSubAgentExecution().
      acc.processEvent(assistantEvent("r1", "I'll explore the repo."));
      const args = { subagentType: { kind: "explore" }, description: "Explore repo structure and docs", prompt: "Go" };

      const run1 = toolCallEvent("tc-explore", "task", "running", "r1", { args, result: "" });
      acc.processEvent(run1);
      acc.trackSubAgentExecution(run1);

      const run2 = toolCallEvent("tc-explore", "task", "running", "r1", { args, result: "" });
      acc.processEvent(run2);
      acc.trackSubAgentExecution(run2);

      const done = toolCallEvent("tc-explore", "task", "completed", "r1", { result: "explored" });
      acc.processEvent(done);
      acc.trackSubAgentExecution(done);

      expect(countToolCallsWithId(messages, "tc-explore")).toBe(1);
      expect(acc.subAgentExecutions).toHaveLength(1);
      expect(acc.subAgentExecutions[0].id).toBe("tc-explore");
    });
  });

  // Issue #179: the live thinking/tool-call trace was starved because the Cursor
  // loop's persist cadence had no force-flush for tool-call lifecycle. The
  // accumulator's isDirty signal is now the force-flush source: it MUST fire on
  // the discrete, user-visible events (tool start, tool finish, sub-agent
  // delegation) and MUST NOT fire on high-frequency token deltas (assistant
  // text, model thinking), which ride the StreamingUpdateScheduler time cadence.
  describe("streaming force-flush signal (issue #179 cadence)", () => {
    it("flags dirty the instant a tool call is created", () => {
      const acc = new MessageAccumulator([]);
      acc.processEvent(assistantEvent("r1", "Let me search."));
      expect(acc.isDirty).toBe(false); // assistant text alone does not force-flush

      acc.processEvent(toolCallEvent("tc-1", "Shell", "running", "r1"));
      expect(acc.isDirty).toBe(true);
    });

    it("flags dirty when a tool call transitions to a terminal status", () => {
      const acc = new MessageAccumulator([]);
      acc.processEvent(assistantEvent("r1", "Running."));
      acc.processEvent(toolCallEvent("tc-1", "Shell", "running", "r1"));
      acc.markPersisted();
      expect(acc.isDirty).toBe(false);

      acc.processEvent(toolCallEvent("tc-1", "Shell", "completed", "r1", { result: "OK" }));
      expect(acc.isDirty).toBe(true);
    });

    it("does NOT re-flag dirty on a redundant terminal re-emit", () => {
      const acc = new MessageAccumulator([]);
      acc.processEvent(assistantEvent("r1", "Running."));
      acc.processEvent(toolCallEvent("tc-1", "read", "running", "r1"));
      acc.processEvent(toolCallEvent("tc-1", "read", "completed", "r1", { result: "data" }));
      acc.markPersisted();
      expect(acc.isDirty).toBe(false);

      // An already-terminal call re-emitting is noise, not a state change.
      acc.processEvent(toolCallEvent("tc-1", "read", "completed", "r1", { result: "" }));
      expect(acc.isDirty).toBe(false);
    });

    it("does NOT flag dirty on model thinking deltas (they ride the scheduler cadence)", () => {
      const acc = new MessageAccumulator([]);
      acc.processEvent(thinkingEvent("r1", "Let me reason about this"));
      acc.processEvent(thinkingEvent("r1", " step by step..."));
      expect(acc.isDirty).toBe(false);
    });

    it("does NOT flag dirty on assistant text deltas", () => {
      const acc = new MessageAccumulator([]);
      acc.processEvent(assistantEvent("r1", "Here is "));
      acc.processEvent(assistantEvent("r1", "the answer."));
      expect(acc.isDirty).toBe(false);
    });

    it("suppressed todo tools do NOT flag dirty (TodoTracker owns that signal)", () => {
      const acc = new MessageAccumulator([]);
      acc.processEvent(assistantEvent("r1", "Planning."));
      acc.processEvent(toolCallEvent("tc-todo", "updateTodos", "running", "r1", {
        args: { todos: [{ content: "Step 1", status: "pending" }] },
      }));
      expect(acc.isDirty).toBe(false);
    });

    it("markPersisted clears a tool-call dirty flag", () => {
      const acc = new MessageAccumulator([]);
      acc.processEvent(assistantEvent("r1", "Running."));
      acc.processEvent(toolCallEvent("tc-1", "Shell", "running", "r1"));
      expect(acc.isDirty).toBe(true);

      acc.markPersisted();
      expect(acc.isDirty).toBe(false);
    });

    // The user-facing symptom: a short thinking+tool turn (< 20 stream events).
    // The old `eventCount % 20` gate never fired, so the whole trace landed only
    // at the final persist. With the force-flush signal, the tool lifecycle is
    // observable mid-turn — each discrete event leaves isDirty set for the loop.
    it("a short thinking+tool turn produces force-flush points mid-turn", () => {
      const acc = new MessageAccumulator([]);
      const flushPoints: string[] = [];
      const step = (label: string, ev: SDKMessage) => {
        acc.processEvent(ev);
        if (acc.isDirty) {
          flushPoints.push(label);
          acc.markPersisted();
        }
      };

      step("thinking", thinkingEvent("r1", "Thinking about the task..."));
      step("assistant", assistantEvent("r1", "I'll check the file."));
      step("tool-start", toolCallEvent("tc-1", "read", "running", "r1"));
      step("tool-done", toolCallEvent("tc-1", "read", "completed", "r1", { result: "contents" }));
      step("assistant-2", assistantEvent("r1", "Done."));

      // Tool start and tool completion are the discrete moments the live UI must
      // see immediately; thinking/assistant deltas are carried by the scheduler.
      expect(flushPoints).toEqual(["tool-start", "tool-done"]);
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

  describe("file changes", () => {
    it("FILE_WRITE yields a WHOLE_FILE CREATE with the new content, at creation time", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages, { workspaceRoot: "/root" });

      acc.processEvent(assistantEvent("r1", "Creating a file."));
      acc.processEvent(
        toolCallEvent("tc-w", "Write", "running", "r1", {
          args: { path: "src/new.ts", contents: "export const x = 1;\n" },
        }),
      );

      const tc = findToolCallById(messages, "tc-w");
      expect(tc?.fileChanges).toHaveLength(1);
      const fc = tc!.fileChanges[0];
      expect(fc.changeType).toBe(FileChangeType.CREATE);
      expect(fc.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
      expect(fc.path).toBe("src/new.ts");
      expect(fc.absolutePath).toBe("/root/src/new.ts");
      expect(fc.after?.body.case).toBe("inline");
      if (fc.after?.body.case === "inline") {
        expect(fc.after.body.value).toBe("export const x = 1;\n");
      }
      expect(fc.before).toBeUndefined();
    });

    it("FILE_EDIT yields a HUNK_ONLY MODIFY from the SDK envelope, on the terminal result", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages, { workspaceRoot: "/root" });

      acc.processEvent(assistantEvent("r1", "Editing."));
      // The running event carries no diff yet — no file change attached.
      acc.processEvent(
        toolCallEvent("tc-e", "StrReplace", "running", "r1", {
          args: { path: "src/app.ts", old_string: "a", new_string: "b" },
        }),
      );
      expect(findToolCallById(messages, "tc-e")?.fileChanges).toHaveLength(0);

      // The terminal result carries the precomputed hunk.
      acc.processEvent(
        toolCallEvent("tc-e", "StrReplace", "completed", "r1", {
          args: { path: "src/app.ts", old_string: "a", new_string: "b" },
          result: {
            status: "completed",
            value: { diffString: "@@ -1 +1 @@\n-a\n+b\n", linesAdded: 1, linesRemoved: 1 },
          },
        }),
      );

      const tc = findToolCallById(messages, "tc-e");
      expect(tc?.fileChanges).toHaveLength(1);
      const fc = tc!.fileChanges[0];
      expect(fc.changeType).toBe(FileChangeType.MODIFY);
      expect(fc.captureLevel).toBe(FileChangeCaptureLevel.HUNK_ONLY);
      expect(fc.path).toBe("src/app.ts");
      expect(fc.unifiedDiff).toBe("@@ -1 +1 @@\n-a\n+b\n");
      expect(fc.linesAdded).toBe(1);
      expect(fc.linesRemoved).toBe(1);
      // HUNK_ONLY carries no whole-file bodies.
      expect(fc.before).toBeUndefined();
      expect(fc.after).toBeUndefined();
    });

    it("non-file tools produce no file changes", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages, { workspaceRoot: "/root" });
      acc.processEvent(assistantEvent("r1", "Running a command."));
      acc.processEvent(toolCallEvent("tc-s", "Shell", "completed", "r1", { result: "ok" }));
      expect(findToolCallById(messages, "tc-s")?.fileChanges).toHaveLength(0);
    });

    it("falls back to the raw arg path when no workspace root is configured", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages);
      acc.processEvent(assistantEvent("r1", "Creating."));
      acc.processEvent(
        toolCallEvent("tc-w", "Write", "running", "r1", {
          args: { path: "src/new.ts", contents: "x" },
        }),
      );
      const fc = findToolCallById(messages, "tc-w")!.fileChanges[0];
      expect(fc.path).toBe("src/new.ts");
      expect(fc.absolutePath).toBe("src/new.ts");
    });

    it("a resumed edit's authoritative HUNK diff supersedes the gate WHOLE_FILE proposal", () => {
      // The prod shape from aex_01kw6tt8d7gz3ph6vww2fq9vt5: a gated edit's
      // pre-approval proposal captured only the bullet fix (WHOLE_FILE
      // before/after, no TODO). On approval + resume the edit runs and the SDK
      // reports the real diff (the bullet fix AND the appended ## TODO). The
      // executed HUNK diff must SUPERSEDE the stale proposal, not be shadowed by
      // it (the missing-diff defect).
      const seeded = create(ToolCallSchema, {
        id: "seed-edit",
        name: "edit",
        status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        requiresApproval: true,
        args: { file_path: "notes.md" },
        argsPreview: JSON.stringify({ file_path: "notes.md", content: "[945 chars]" }),
        fileChanges: [
          buildFileChange({
            path: "notes.md",
            absolutePath: "/root/notes.md",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: "# Project Notes\n\n- hello-world service\n",
            after: "# Project Notes\n\n- hello world service\n",
          }),
        ],
      });
      const messages: AgentMessage[] = [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [seeded],
        }),
      ];
      // Constructed over a seeded transcript: rebuildToolCallIndex re-indexes the
      // WAITING_APPROVAL call so the resumed event reconciles onto it.
      const acc = new MessageAccumulator(messages, { workspaceRoot: "/root" });

      const diffString =
        "@@ -1,3 +1,3 @@\n # Project Notes\n \n-- hello-world service\n" +
        "+- hello world service\n@@ -3,1 +3,6 @@\n+\n+## TODO\n+\n+- a\n+- b\n";
      acc.processEvent(
        toolCallEvent("resumed-edit", "edit", "completed", "r2", {
          args: { file_path: "notes.md" },
          result: {
            status: "completed",
            value: { diffString, linesAdded: 6, linesRemoved: 1 },
          },
        }),
      );

      // The resumed call reconciled onto the seeded proto (committed id preserved).
      const tc = findToolCallById(messages, "seed-edit");
      expect(tc).toBeDefined();
      expect(tc!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(tc!.fileChanges).toHaveLength(1);
      const fc = tc!.fileChanges[0];
      expect(fc.captureLevel).toBe(FileChangeCaptureLevel.HUNK_ONLY);
      expect(fc.linesAdded).toBe(6);
      expect(fc.linesRemoved).toBe(1);
      expect(fc.unifiedDiff).toContain("## TODO");
      // The stale WHOLE_FILE proposal no longer shadows the executed diff.
      expect(fc.before).toBeUndefined();
      expect(fc.after).toBeUndefined();
    });

    it("a gated write's WHOLE_FILE before/after proposal is not downgraded by a stream CREATE", () => {
      // A gated write's gate proposal reads the pre-edit `before` from disk for a
      // true before/after; the executed stream capture is a content-only CREATE
      // (no before). The poorer CREATE must NOT overwrite the richer proposal.
      const seeded = create(ToolCallSchema, {
        id: "seed-write",
        name: "write",
        status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
        requiresApproval: true,
        args: { file_path: "cfg.json" },
        fileChanges: [
          buildFileChange({
            path: "cfg.json",
            absolutePath: "/root/cfg.json",
            changeType: FileChangeType.MODIFY,
            captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
            before: '{\n  "a": 1\n}\n',
            after: '{\n  "a": 2\n}\n',
          }),
        ],
      });
      const messages: AgentMessage[] = [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_AI,
          toolCalls: [seeded],
        }),
      ];
      const acc = new MessageAccumulator(messages, { workspaceRoot: "/root" });

      acc.processEvent(
        toolCallEvent("resumed-write", "write", "completed", "r2", {
          args: { file_path: "cfg.json", contents: '{\n  "a": 2\n}\n' },
          result: "ok",
        }),
      );

      const tc = findToolCallById(messages, "seed-write");
      expect(tc!.fileChanges).toHaveLength(1);
      const fc = tc!.fileChanges[0];
      // Still the richer WHOLE_FILE before/after — not a content-only CREATE.
      expect(fc.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
      expect(fc.changeType).toBe(FileChangeType.MODIFY);
      expect(fc.before?.body.case).toBe("inline");
    });

    it("a result-less running re-emit does not wipe a captured diff", () => {
      const messages: AgentMessage[] = [];
      const acc = new MessageAccumulator(messages, { workspaceRoot: "/root" });
      acc.processEvent(assistantEvent("r1", "Editing."));
      acc.processEvent(
        toolCallEvent("tc-reemit", "StrReplace", "completed", "r1", {
          args: { path: "src/app.ts", old_string: "a", new_string: "b" },
          result: {
            status: "completed",
            value: { diffString: "@@ -1 +1 @@\n-a\n+b\n", linesAdded: 1, linesRemoved: 1 },
          },
        }),
      );
      expect(findToolCallById(messages, "tc-reemit")?.fileChanges).toHaveLength(1);

      // A late, result-less "running" re-emit must not wipe the captured diff.
      acc.processEvent(
        toolCallEvent("tc-reemit", "StrReplace", "running", "r1", {
          args: { path: "src/app.ts", old_string: "a", new_string: "b" },
        }),
      );
      const fc = findToolCallById(messages, "tc-reemit")?.fileChanges[0];
      expect(fc?.captureLevel).toBe(FileChangeCaptureLevel.HUNK_ONLY);
      expect(fc?.unifiedDiff).toContain("+b");
    });
  });
});
