import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionState } from "../execution-state.js";

function makeEmptyStatus() {
  return create(AgentExecutionStatusSchema, {});
}

describe("ExecutionState", () => {
  it("initializes with the given proto", () => {
    const proto = makeEmptyStatus();
    const state = new ExecutionState(proto);
    expect(state.proto).toBe(proto);
  });

  it("starts with empty indexes", () => {
    const state = new ExecutionState(makeEmptyStatus());
    expect(state.toolCalls.size).toBe(0);
    expect(state.messagesByRun.size).toBe(0);
    expect(state.currentAiMessage.size).toBe(0);
    expect(state.lastLlmRunId.size).toBe(0);
    expect(state.toolStartTimes.size).toBe(0);
  });

  it("indexes share object references with proto repeated fields", () => {
    const proto = makeEmptyStatus();
    const state = new ExecutionState(proto);

    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "hello",
      timestamp: "2026-05-19T00:00:00Z",
    });
    proto.messages.push(msg);
    state.currentAiMessage.set("", msg);

    msg.content += " world";

    expect(proto.messages[0].content).toBe("hello world");
    expect(state.currentAiMessage.get("")!.content).toBe("hello world");
  });

  it("tool call index shares references with message toolCalls", () => {
    const proto = makeEmptyStatus();
    const state = new ExecutionState(proto);

    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "read",
      status: ToolCallStatus.TOOL_CALL_RUNNING,
    });
    const msg = create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      timestamp: "2026-05-19T00:00:00Z",
      toolCalls: [tc],
    });
    proto.messages.push(msg);
    state.toolCalls.set(tc.id, tc);

    tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
    tc.result = "file contents";

    expect(state.toolCalls.get("tc-1")!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(proto.messages[0].toolCalls[0].result).toBe("file contents");
  });

  describe("resetEphemeralState", () => {
    it("clears runtime maps but preserves proto", () => {
      const proto = makeEmptyStatus();
      const state = new ExecutionState(proto);

      const msg = create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "test",
        timestamp: "2026-05-19T00:00:00Z",
      });
      proto.messages.push(msg);
      state.messagesByRun.set("run-1", msg);
      state.currentAiMessage.set("", msg);
      state.lastLlmRunId.set("", "run-1");
      state.toolStartTimes.set("tool-run-1", 1000);

      state.resetEphemeralState();

      expect(state.messagesByRun.size).toBe(0);
      expect(state.currentAiMessage.size).toBe(0);
      expect(state.lastLlmRunId.size).toBe(0);
      expect(state.toolStartTimes.size).toBe(0);
      expect(proto.messages).toHaveLength(1);
    });

    it("does not clear the toolCalls index", () => {
      const proto = makeEmptyStatus();
      const state = new ExecutionState(proto);

      const tc = create(ToolCallSchema, { id: "tc-1", name: "write" });
      state.toolCalls.set("tc-1", tc);

      state.resetEphemeralState();

      expect(state.toolCalls.size).toBe(1);
    });
  });

  describe("rebuildToolCallIndex", () => {
    it("rebuilds from proto messages", () => {
      const tc1 = create(ToolCallSchema, { id: "tc-1", name: "read" });
      const tc2 = create(ToolCallSchema, { id: "tc-2", name: "write" });
      const msg = create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "",
        timestamp: "2026-05-19T00:00:00Z",
        toolCalls: [tc1, tc2],
      });
      const proto = create(AgentExecutionStatusSchema, { messages: [msg] });
      const state = new ExecutionState(proto);

      state.rebuildToolCallIndex();

      expect(state.toolCalls.size).toBe(2);
      expect(state.toolCalls.get("tc-1")).toBe(tc1);
      expect(state.toolCalls.get("tc-2")).toBe(tc2);
    });

    it("skips tool calls with empty id", () => {
      const tc = create(ToolCallSchema, { id: "", name: "read" });
      const msg = create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "",
        timestamp: "2026-05-19T00:00:00Z",
        toolCalls: [tc],
      });
      const proto = create(AgentExecutionStatusSchema, { messages: [msg] });
      const state = new ExecutionState(proto);

      state.rebuildToolCallIndex();

      expect(state.toolCalls.size).toBe(0);
    });

    it("clears previous index before rebuilding", () => {
      const proto = create(AgentExecutionStatusSchema, {});
      const state = new ExecutionState(proto);

      state.toolCalls.set("stale-id", create(ToolCallSchema, { id: "stale-id" }));
      expect(state.toolCalls.size).toBe(1);

      state.rebuildToolCallIndex();

      expect(state.toolCalls.size).toBe(0);
    });
  });
});
