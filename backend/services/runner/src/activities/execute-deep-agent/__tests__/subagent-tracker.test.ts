import { describe, it, expect, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { SubAgentStatus, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { V3StatusBuilder } from "../v3-status-builder.js";
import { normalize } from "../v3-protocol-normalizer.js";
import type { V3ProtocolEvent } from "../v3-event-recorder.js";
import {
  resetSeq,
  makeMessageStart,
  makeMessageFinish,
  makeTextDelta,
  makeReasoningDelta,
  makeToolStarted,
  makeToolFinished,
  makeToolError,
  makeToolOutputDelta,
  makeProtocolEvent,
} from "../__test-utils__/v3-event-fixtures.js";

function makeBuilder(): V3StatusBuilder {
  return new V3StatusBuilder("exec-test", create(AgentExecutionStatusSchema, {}));
}

function feedAll(sb: V3StatusBuilder, events: V3ProtocolEvent[]): void {
  for (const raw of events) {
    for (const e of normalize(raw)) {
      sb.processEvent(e);
    }
  }
}

/**
 * Simulates the LangGraph tools-node Pregel segment for a given tool execution.
 * In real runtime this is "tools:<pregelUuid>" where the UUID is a deterministic
 * hash derived from the checkpoint state — distinct from the provider tool call ID.
 */
function toolsNodeSegment(callId: string): string {
  return `tools:pregel_${callId}`;
}

function makeTaskToolStarted(callId: string, subagentType: string, description: string): V3ProtocolEvent {
  return makeProtocolEvent("tools", {
    event: "tool-started",
    tool_call_id: callId,
    tool_name: "task",
    input: { subagent_type: subagentType, description },
  }, { namespace: [toolsNodeSegment(callId)] });
}

function makeTaskToolFinished(callId: string, output: string): V3ProtocolEvent {
  return makeProtocolEvent("tools", {
    event: "tool-finished",
    tool_call_id: callId,
    output: {
      lc: 1, type: "constructor",
      id: ["langchain_core", "messages", "ToolMessage"],
      kwargs: { status: "success", content: output, tool_call_id: callId, name: "task" },
    },
  }, { namespace: [toolsNodeSegment(callId)] });
}

function makeTaskToolError(callId: string, message: string): V3ProtocolEvent {
  return makeProtocolEvent("tools", {
    event: "tool-error",
    tool_call_id: callId,
    message,
  }, { namespace: [toolsNodeSegment(callId)] });
}

function makeSubAgentEvent(taskCallId: string, method: string, data: unknown, extraNs?: string): V3ProtocolEvent {
  const ns = extraNs
    ? [toolsNodeSegment(taskCallId), extraNs]
    : [toolsNodeSegment(taskCallId), "model_request"];
  return makeProtocolEvent(method, data, { namespace: ns, node: "model_request" });
}

beforeEach(() => resetSeq());

describe("SubAgentTracker (via V3StatusBuilder integration)", () => {

  describe("lifecycle — happy path", () => {
    it("creates SubAgentExecution on task tool_started", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("parent-1"),
        makeTextDelta("parent-1", "Delegating to researcher."),
        makeMessageFinish("parent-1"),
        makeTaskToolStarted("call_sub_1", "researcher", "Research renewable energy"),
      ]);

      sb.syncSubAgentExecutions();
      const subs = sb.currentStatus.subAgentExecutions;
      expect(subs).toHaveLength(1);
      expect(subs[0].id).toBe("call_sub_1");
      expect(subs[0].name).toBe("researcher");
      expect(subs[0].subject).toBe("Research renewable energy");
      expect(subs[0].input).toBe("Research renewable energy");
      expect(subs[0].status).toBe(SubAgentStatus.SUB_AGENT_IN_PROGRESS);
      expect(subs[0].startedAt).toBeTruthy();
    });

    it("marks SubAgentExecution COMPLETED on task tool_finished", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeTaskToolStarted("call_sub_1", "researcher", "Research topic"),
        makeTaskToolFinished("call_sub_1", "Renewable energy summary here."),
      ]);

      sb.syncSubAgentExecutions();
      const sub = sb.currentStatus.subAgentExecutions[0];
      expect(sub.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
      expect(sub.output).toBe("Renewable energy summary here.");
      expect(sub.completedAt).toBeTruthy();
    });

    it("marks SubAgentExecution FAILED on task tool_error", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeTaskToolStarted("call_sub_1", "researcher", "Research topic"),
        makeTaskToolError("call_sub_1", "Context overflow in sub-agent"),
      ]);

      sb.syncSubAgentExecutions();
      const sub = sb.currentStatus.subAgentExecutions[0];
      expect(sub.status).toBe(SubAgentStatus.SUB_AGENT_FAILED);
      expect(sub.error).toBe("Context overflow in sub-agent");
      expect(sub.completedAt).toBeTruthy();
    });
  });

  describe("lifecycle — cancellation", () => {
    it("cancelSubAgents marks active sub-agents as CANCELLED", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeTaskToolStarted("call_sub_1", "researcher", "Task 1"),
        makeTaskToolStarted("call_sub_2", "shell", "Task 2"),
      ]);

      sb.cancelSubAgents();
      const subs = sb.currentStatus.subAgentExecutions;
      expect(subs).toHaveLength(2);
      expect(subs[0].status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
      expect(subs[0].error).toContain("parent execution was cancelled");
      expect(subs[1].status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    });

    it("does not cancel already-completed sub-agents", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeTaskToolStarted("call_sub_1", "researcher", "Task 1"),
        makeTaskToolFinished("call_sub_1", "done"),
        makeTaskToolStarted("call_sub_2", "shell", "Task 2"),
      ]);

      sb.cancelSubAgents();
      const subs = sb.currentStatus.subAgentExecutions;
      expect(subs[0].status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
      expect(subs[1].status).toBe(SubAgentStatus.SUB_AGENT_CANCELLED);
    });
  });

  describe("namespace routing — sub-agent messages isolated from parent", () => {
    it("routes sub-agent text events to SubAgentExecution.messages", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("parent-1"),
        makeTextDelta("parent-1", "Delegating."),
        makeMessageFinish("parent-1"),
        makeTaskToolStarted("call_sub_1", "researcher", "Research topic"),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "message-start", id: "msg_sub_1", run_id: "sub-run-1",
        }),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "content-block-delta", index: 0,
          delta: { type: "text-delta", text: "I found results." },
          run_id: "sub-run-1",
        }),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "message-finish", reason: "end_turn", run_id: "sub-run-1",
        }),
        makeTaskToolFinished("call_sub_1", "Research complete."),
      ]);

      sb.syncSubAgentExecutions();

      // Parent messages should NOT contain sub-agent text
      const parentMessages = sb.currentStatus.messages;
      expect(parentMessages).toHaveLength(1);
      expect(parentMessages[0].content).toBe("Delegating.");
      expect(parentMessages[0].toolCalls).toHaveLength(1);
      expect(parentMessages[0].toolCalls[0].name).toBe("task");

      // Sub-agent should have its own messages
      const sub = sb.currentStatus.subAgentExecutions[0];
      expect(sub.messages).toHaveLength(1);
      expect(sub.messages[0].content).toBe("I found results.");
      expect(sub.messages[0].type).toBe(MessageType.MESSAGE_AI);
    });

    it("routes sub-agent thinking events to SubAgentExecution.messages", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeTaskToolStarted("call_sub_1", "researcher", "Research"),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "content-block-delta", index: 0,
          delta: { type: "reasoning-delta", reasoning: "Let me think..." },
          run_id: "sub-run-1",
        }),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "message-start", id: "msg_sub_2", run_id: "sub-run-1",
        }),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "content-block-delta", index: 0,
          delta: { type: "text-delta", text: "Here are the results." },
          run_id: "sub-run-1",
        }),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "message-finish", reason: "end_turn", run_id: "sub-run-1",
        }),
      ]);

      sb.syncSubAgentExecutions();
      const sub = sb.currentStatus.subAgentExecutions[0];
      expect(sub.messages).toHaveLength(2);
      expect(sub.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(sub.messages[0].content).toBe("Let me think...");
      expect(sub.messages[1].type).toBe(MessageType.MESSAGE_AI);
      expect(sub.messages[1].content).toBe("Here are the results.");

      // Parent has one message: the AI message hosting the task tool_call
      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].toolCalls[0].name).toBe("task");
    });
  });

  describe("sub-agent tool calls", () => {
    it("tracks tool calls within sub-agent context", () => {
      const sb = makeBuilder();
      const taskCallId = "call_task_1";
      const subToolCallId = "call_grep_1";

      feedAll(sb, [
        makeTaskToolStarted(taskCallId, "explore", "Find the auth module"),
        makeSubAgentEvent(taskCallId, "messages", {
          event: "message-start", id: "msg_sub", run_id: "sub-run-1",
        }),
        makeSubAgentEvent(taskCallId, "messages", {
          event: "content-block-delta", index: 0,
          delta: { type: "text-delta", text: "Searching..." },
          run_id: "sub-run-1",
        }),
        makeProtocolEvent("tools", {
          event: "tool-started",
          tool_call_id: subToolCallId,
          tool_name: "grep",
          input: { pattern: "auth", path: "src/" },
        }, { namespace: [toolsNodeSegment(taskCallId), `tools:${subToolCallId}`] }),
        makeProtocolEvent("tools", {
          event: "tool-finished",
          tool_call_id: subToolCallId,
          output: { lc: 1, type: "constructor", id: ["langchain_core", "messages", "ToolMessage"], kwargs: { content: "Found 3 matches", status: "success", tool_call_id: subToolCallId, name: "grep" } },
        }, { namespace: [toolsNodeSegment(taskCallId), `tools:${subToolCallId}`] }),
      ]);

      sb.syncSubAgentExecutions();
      const sub = sb.currentStatus.subAgentExecutions[0];
      expect(sub.messages).toHaveLength(1);
      expect(sub.messages[0].toolCalls).toHaveLength(1);
      expect(sub.messages[0].toolCalls[0].name).toBe("grep");
      expect(sub.messages[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(sub.messages[0].toolCalls[0].result).toBe("Found 3 matches");
    });
  });

  describe("multiple concurrent sub-agents", () => {
    it("tracks multiple sub-agents independently", () => {
      const sb = makeBuilder();

      feedAll(sb, [
        makeTaskToolStarted("call_sub_1", "researcher", "Research topic A"),
        makeTaskToolStarted("call_sub_2", "shell", "Run tests"),
        // Sub-agent 1 text
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "message-start", id: "msg_1", run_id: "run-a",
        }),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "content-block-delta", index: 0,
          delta: { type: "text-delta", text: "Topic A findings." },
          run_id: "run-a",
        }),
        makeSubAgentEvent("call_sub_1", "messages", {
          event: "message-finish", reason: "end_turn", run_id: "run-a",
        }),
        // Sub-agent 2 text
        makeSubAgentEvent("call_sub_2", "messages", {
          event: "message-start", id: "msg_2", run_id: "run-b",
        }),
        makeSubAgentEvent("call_sub_2", "messages", {
          event: "content-block-delta", index: 0,
          delta: { type: "text-delta", text: "Tests passed." },
          run_id: "run-b",
        }),
        makeSubAgentEvent("call_sub_2", "messages", {
          event: "message-finish", reason: "end_turn", run_id: "run-b",
        }),
        makeTaskToolFinished("call_sub_1", "A done"),
        makeTaskToolFinished("call_sub_2", "B done"),
      ]);

      sb.syncSubAgentExecutions();
      const subs = sb.currentStatus.subAgentExecutions;
      expect(subs).toHaveLength(2);

      expect(subs[0].name).toBe("researcher");
      expect(subs[0].messages).toHaveLength(1);
      expect(subs[0].messages[0].content).toBe("Topic A findings.");
      expect(subs[0].status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);

      expect(subs[1].name).toBe("shell");
      expect(subs[1].messages).toHaveLength(1);
      expect(subs[1].messages[0].content).toBe("Tests passed.");
      expect(subs[1].status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    });

    it("same sub-agent type invoked twice uses unique callIds", () => {
      const sb = makeBuilder();

      feedAll(sb, [
        makeTaskToolStarted("call_1", "researcher", "Research A"),
        makeTaskToolFinished("call_1", "Result A"),
        makeTaskToolStarted("call_2", "researcher", "Research B"),
        makeTaskToolFinished("call_2", "Result B"),
      ]);

      sb.syncSubAgentExecutions();
      const subs = sb.currentStatus.subAgentExecutions;
      expect(subs).toHaveLength(2);
      expect(subs[0].id).toBe("call_1");
      expect(subs[0].output).toBe("Result A");
      expect(subs[1].id).toBe("call_2");
      expect(subs[1].output).toBe("Result B");
    });
  });

  describe("parent timeline integrity", () => {
    it("task tool_call appears in parent AI message", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("parent-1"),
        makeTextDelta("parent-1", "Let me delegate."),
        makeMessageFinish("parent-1"),
        makeTaskToolStarted("call_sub_1", "researcher", "Research X"),
        makeTaskToolFinished("call_sub_1", "X results"),
        makeMessageStart("parent-2"),
        makeTextDelta("parent-2", "The research is complete."),
        makeMessageFinish("parent-2"),
      ]);

      sb.syncSubAgentExecutions();
      const msgs = sb.currentStatus.messages;

      // First AI message has the task tool call
      expect(msgs[0].content).toBe("Let me delegate.");
      expect(msgs[0].toolCalls).toHaveLength(1);
      expect(msgs[0].toolCalls[0].name).toBe("task");
      expect(msgs[0].toolCalls[0].id).toBe("call_sub_1");
      expect(msgs[0].toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(msgs[0].toolCalls[0].result).toBe("X results");

      // Second AI message resumes
      expect(msgs[1].content).toBe("The research is complete.");
    });
  });

  describe("edge cases", () => {
    it("idempotent on duplicate task tool_started", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeTaskToolStarted("call_sub_1", "researcher", "Research"),
        makeTaskToolStarted("call_sub_1", "researcher", "Research"),
      ]);

      sb.syncSubAgentExecutions();
      expect(sb.currentStatus.subAgentExecutions).toHaveLength(1);
    });

    it("handles tool_finished for unknown callId gracefully", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeTaskToolFinished("unknown_call_id", "output"),
      ]);

      sb.syncSubAgentExecutions();
      expect(sb.currentStatus.subAgentExecutions).toHaveLength(0);
    });

    it("events for non-tracked namespace pass to parent", () => {
      const sb = makeBuilder();
      feedAll(sb, [
        makeMessageStart("parent-1"),
        makeTextDelta("parent-1", "Normal text."),
        makeMessageFinish("parent-1"),
      ]);

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("Normal text.");
    });

    it("depth-0 task tool_started (empty namespace) uses callId-based prefix", () => {
      const sb = makeBuilder();
      const callId = "call_depth0";

      feedAll(sb, [
        makeProtocolEvent("tools", {
          event: "tool-started",
          tool_call_id: callId,
          tool_name: "task",
          input: { subagent_type: "researcher", description: "Depth-0 test" },
        }, { namespace: [] }),
        // Sub-agent child events use tools:<callId> as first segment (fallback prefix)
        makeProtocolEvent("messages", {
          event: "message-start", id: "msg_sub", run_id: "sub-run",
        }, { namespace: [`tools:${callId}`, "model_request"], node: "model_request" }),
        makeProtocolEvent("messages", {
          event: "content-block-delta", index: 0,
          delta: { type: "text-delta", text: "Depth-0 child event." },
          run_id: "sub-run",
        }, { namespace: [`tools:${callId}`, "model_request"], node: "model_request" }),
        makeProtocolEvent("messages", {
          event: "message-finish", reason: "end_turn", run_id: "sub-run",
        }, { namespace: [`tools:${callId}`, "model_request"], node: "model_request" }),
      ]);

      sb.syncSubAgentExecutions();
      const subs = sb.currentStatus.subAgentExecutions;
      expect(subs).toHaveLength(1);
      expect(subs[0].name).toBe("researcher");
      expect(subs[0].messages).toHaveLength(1);
      expect(subs[0].messages[0].content).toBe("Depth-0 child event.");
    });

    it("depth-1 events with registered prefix but no pipe stay in parent pipeline", () => {
      const sb = makeBuilder();
      const callId = "call_depth1_test";

      feedAll(sb, [
        makeTaskToolStarted(callId, "researcher", "Test isolation"),
        // Parent continues with a new message after delegation
        makeProtocolEvent("messages", {
          event: "message-start", id: "msg_parent", run_id: "parent-run",
        }, { namespace: [], node: "model_request" }),
        makeProtocolEvent("messages", {
          event: "content-block-delta", index: 0,
          delta: { type: "text-delta", text: "Parent continues." },
          run_id: "parent-run",
        }, { namespace: [], node: "model_request" }),
        makeProtocolEvent("messages", {
          event: "message-finish", reason: "end_turn", run_id: "parent-run",
        }, { namespace: [], node: "model_request" }),
      ]);

      sb.syncSubAgentExecutions();
      // First message: AI message with task tool call (created by handleToolStarted)
      // Second message: parent text that follows
      expect(sb.currentStatus.messages).toHaveLength(2);
      expect(sb.currentStatus.messages[0].toolCalls[0].name).toBe("task");
      expect(sb.currentStatus.messages[1].content).toBe("Parent continues.");
      // Sub-agent has no messages (only registered, no child events routed)
      const sub = sb.currentStatus.subAgentExecutions[0];
      expect(sub.messages).toHaveLength(0);
    });
  });
});
