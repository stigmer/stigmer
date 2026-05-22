/**
 * Extended ExecutionState tests — ported from Python test_hitl_contracts.py
 * and test_checkpoint_validator.py sections covering state rebuild/reset.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionState } from "../execution-state.js";

function makeStateWithMessages(): ExecutionState {
  const status = create(AgentExecutionStatusSchema, {});
  const msg = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "test",
    toolCalls: [
      create(ToolCallSchema, {
        id: "tc-1",
        name: "read",
        status: ToolCallStatus.TOOL_CALL_COMPLETED,
      }),
      create(ToolCallSchema, {
        id: "tc-2",
        name: "write",
        status: ToolCallStatus.TOOL_CALL_RUNNING,
      }),
    ],
  });
  status.messages.push(msg);

  const msg2 = create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "turn 2",
    toolCalls: [
      create(ToolCallSchema, {
        id: "tc-3",
        name: "search",
        status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      }),
    ],
  });
  status.messages.push(msg2);

  return new ExecutionState(status);
}

describe("ExecutionState", () => {
  describe("rebuildToolCallIndex", () => {
    it("indexes all tool calls from proto messages", () => {
      const state = makeStateWithMessages();
      state.rebuildToolCallIndex();

      expect(state.toolCalls.size).toBe(3);
      expect(state.toolCalls.get("tc-1")!.name).toBe("read");
      expect(state.toolCalls.get("tc-2")!.name).toBe("write");
      expect(state.toolCalls.get("tc-3")!.name).toBe("search");
    });

    it("clears previous index before rebuilding", () => {
      const state = makeStateWithMessages();
      state.toolCalls.set("stale-id", create(ToolCallSchema, { id: "stale-id", name: "stale" }));

      state.rebuildToolCallIndex();

      expect(state.toolCalls.has("stale-id")).toBe(false);
      expect(state.toolCalls.size).toBe(3);
    });

    it("skips tool calls without id", () => {
      const status = create(AgentExecutionStatusSchema, {});
      const msg = create(AgentMessageSchema, {
        type: MessageType.MESSAGE_AI,
        content: "test",
        toolCalls: [
          create(ToolCallSchema, { id: "", name: "no-id" }),
          create(ToolCallSchema, { id: "has-id", name: "valid" }),
        ],
      });
      status.messages.push(msg);

      const state = new ExecutionState(status);
      state.rebuildToolCallIndex();

      expect(state.toolCalls.size).toBe(1);
      expect(state.toolCalls.has("has-id")).toBe(true);
    });

    it("handles empty messages array", () => {
      const state = new ExecutionState(create(AgentExecutionStatusSchema, {}));
      state.rebuildToolCallIndex();
      expect(state.toolCalls.size).toBe(0);
    });

    it("maintains reference identity with proto objects", () => {
      const state = makeStateWithMessages();
      state.rebuildToolCallIndex();

      const tc = state.toolCalls.get("tc-1")!;
      tc.status = ToolCallStatus.TOOL_CALL_FAILED;

      expect(state.proto.messages[0].toolCalls[0].status).toBe(
        ToolCallStatus.TOOL_CALL_FAILED,
      );
    });
  });

  describe("resetEphemeralState", () => {
    it("clears all runtime maps", () => {
      const state = makeStateWithMessages();
      state.messagesByRun.set("run-1", state.proto.messages[0]);
      state.currentAiMessage.set("", state.proto.messages[0]);
      state.lastLlmRunId.set("", "run-1");
      state.toolStartTimes.set("tc-1", 12345);

      state.resetEphemeralState();

      expect(state.messagesByRun.size).toBe(0);
      expect(state.currentAiMessage.size).toBe(0);
      expect(state.lastLlmRunId.size).toBe(0);
      expect(state.toolStartTimes.size).toBe(0);
    });

    it("does not clear proto or toolCalls index", () => {
      const state = makeStateWithMessages();
      state.rebuildToolCallIndex();
      state.messagesByRun.set("run-1", state.proto.messages[0]);

      state.resetEphemeralState();

      expect(state.proto.messages).toHaveLength(2);
      expect(state.toolCalls.size).toBe(3);
    });
  });

  describe("proto reference", () => {
    it("exposes the original proto object", () => {
      const status = create(AgentExecutionStatusSchema, {});
      const state = new ExecutionState(status);
      expect(state.proto).toBe(status);
    });
  });
});
