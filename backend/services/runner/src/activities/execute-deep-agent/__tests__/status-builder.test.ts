import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StatusBuilder, type StreamEvent } from "../status-builder.js";

function makeBuilder() {
  const status = create(AgentExecutionStatusSchema, {});
  return new StatusBuilder("exec-test", status);
}

function chatStreamEvent(
  runId: string,
  content: string | Record<string, unknown>[],
  metadata?: Record<string, unknown>,
): StreamEvent {
  return {
    event: "on_chat_model_stream",
    name: "ChatAnthropic",
    run_id: runId,
    data: { chunk: { content } },
    metadata,
  };
}

function chatEndEvent(
  runId: string,
  usageMetadata?: Record<string, unknown>,
): StreamEvent {
  return {
    event: "on_chat_model_end",
    name: "ChatAnthropic",
    run_id: runId,
    data: {
      output: {
        content: "final text",
        usage_metadata: usageMetadata,
      },
    },
  };
}

function toolStartEvent(
  runId: string,
  toolName: string,
  input?: Record<string, unknown>,
): StreamEvent {
  return {
    event: "on_tool_start",
    name: toolName,
    run_id: runId,
    data: { input: input ?? {} },
  };
}

function toolEndEvent(
  runId: string,
  output: unknown,
): StreamEvent {
  return {
    event: "on_tool_end",
    name: "some_tool",
    run_id: runId,
    data: { output },
  };
}

describe("StatusBuilder", () => {
  describe("initialization", () => {
    it("sets phase to IN_PROGRESS", () => {
      const sb = makeBuilder();
      expect(sb.currentStatus.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    });

    it("sets startedAt timestamp", () => {
      const sb = makeBuilder();
      expect(sb.currentStatus.startedAt).toBeTruthy();
    });

    it("starts with forceNextUpdate = false", () => {
      expect(makeBuilder().forceNextUpdate).toBe(false);
    });
  });

  describe("on_chat_model_stream — text tokens", () => {
    it("creates an AI message and appends text", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "Hello"));
      sb.processEvent(chatStreamEvent("run-1", " world"));

      expect(sb.currentStatus.messages).toHaveLength(1);
      const msg = sb.currentStatus.messages[0];
      expect(msg.type).toBe(MessageType.MESSAGE_AI);
      expect(msg.content).toBe("Hello world");
      expect(msg.isStreaming).toBe(true);
    });

    it("handles content block array with text blocks", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "text", text: "block text" },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("block text");
    });

    it("ignores empty string content", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", ""));

      expect(sb.currentStatus.messages).toHaveLength(0);
    });

    it("ignores events with no chunk data", () => {
      const sb = makeBuilder();
      sb.processEvent({
        event: "on_chat_model_stream",
        run_id: "run-1",
        data: {},
      });

      expect(sb.currentStatus.messages).toHaveLength(0);
    });
  });

  describe("on_chat_model_stream — thinking blocks", () => {
    it("creates a THINKING message for thinking content", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Let me reason..." },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(1);
      const msg = sb.currentStatus.messages[0];
      expect(msg.type).toBe(MessageType.MESSAGE_THINKING);
      expect(msg.content).toBe("Let me reason...");
      expect(msg.isStreaming).toBe(true);
    });

    it("appends to existing thinking message in same namespace", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Step 1. " },
      ]));
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "Step 2." },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("Step 1. Step 2.");
    });

    it("handles mixed thinking and text in same event", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", [
        { type: "thinking", thinking: "hmm..." },
        { type: "text", text: "answer" },
      ]));

      expect(sb.currentStatus.messages).toHaveLength(2);
      expect(sb.currentStatus.messages[0].type).toBe(MessageType.MESSAGE_THINKING);
      expect(sb.currentStatus.messages[1].type).toBe(MessageType.MESSAGE_AI);
    });
  });

  describe("turn boundary detection", () => {
    it("creates new message when run_id changes", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "First turn"));
      sb.processEvent(chatStreamEvent("run-2", "Second turn"));

      expect(sb.currentStatus.messages).toHaveLength(2);
      expect(sb.currentStatus.messages[0].content).toBe("First turn");
      expect(sb.currentStatus.messages[0].isStreaming).toBe(false);
      expect(sb.currentStatus.messages[1].content).toBe("Second turn");
      expect(sb.currentStatus.messages[1].isStreaming).toBe(true);
    });

    it("reuses same message for same run_id", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "a"));
      sb.processEvent(chatStreamEvent("run-1", "b"));

      expect(sb.currentStatus.messages).toHaveLength(1);
      expect(sb.currentStatus.messages[0].content).toBe("ab");
    });
  });

  describe("on_chat_model_end", () => {
    it("finalizes message streaming flag", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      expect(sb.currentStatus.messages[0].isStreaming).toBe(true);

      sb.processEvent(chatEndEvent("run-1"));
      expect(sb.currentStatus.messages[0].isStreaming).toBe(false);
    });

    it("accumulates usage metadata", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      }));

      const usage = sb.currentStatus.runnerUsage;
      expect(usage).toBeDefined();
      expect(usage!.inputTokens).toBe(100n);
      expect(usage!.outputTokens).toBe(50n);
      expect(usage!.cacheReadTokens).toBe(10n);
      expect(usage!.cacheWriteTokens).toBe(5n);
      expect(usage!.totalTokens).toBe(165n);
      expect(usage!.turnCount).toBe(1);
    });

    it("accumulates across multiple turns", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "turn 1"));
      sb.processEvent(chatEndEvent("run-1", {
        input_tokens: 100,
        output_tokens: 50,
      }));
      sb.processEvent(chatStreamEvent("run-2", "turn 2"));
      sb.processEvent(chatEndEvent("run-2", {
        input_tokens: 200,
        output_tokens: 100,
      }));

      const usage = sb.currentStatus.runnerUsage!;
      expect(usage.inputTokens).toBe(300n);
      expect(usage.outputTokens).toBe(150n);
      expect(usage.turnCount).toBe(2);
    });
  });

  describe("on_tool_start", () => {
    it("creates a RUNNING tool call on the current AI message", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "I'll read a file"));
      sb.processEvent(toolStartEvent("tool-run-1", "read", { path: "/foo.ts" }));

      const msg = sb.currentStatus.messages[0];
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls[0].id).toBe("tool-run-1");
      expect(msg.toolCalls[0].name).toBe("read");
      expect(msg.toolCalls[0].status).toBe(ToolCallStatus.TOOL_CALL_RUNNING);
      expect(msg.toolCalls[0].startedAt).toBeTruthy();
      expect(msg.toolCalls[0].args).toEqual({ path: "/foo.ts" });
    });

    it("sets forceNextUpdate", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));

      expect(sb.forceNextUpdate).toBe(true);
    });

    it("does nothing if no current AI message exists", () => {
      const sb = makeBuilder();
      sb.processEvent(toolStartEvent("tool-run-1", "read"));

      expect(sb.currentStatus.messages).toHaveLength(0);
    });
  });

  describe("on_tool_end", () => {
    it("marks tool call as COMPLETED with result", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "reading file"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));
      sb.processEvent(toolEndEvent("tool-run-1", "file contents here"));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(tc.result).toBe("file contents here");
      expect(tc.completedAt).toBeTruthy();
      expect(tc.isStreaming).toBe(false);
    });

    it("marks tool call as FAILED when output has error", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "write"));
      sb.processEvent(toolEndEvent("tool-run-1", { error: "permission denied" }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(tc.error).toBe("permission denied");
    });

    it("truncates long results", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));

      const longResult = "x".repeat(60_000);
      sb.processEvent(toolEndEvent("tool-run-1", longResult));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.result.length).toBeLessThan(longResult.length);
      expect(tc.result).toContain("[truncated:");
    });

    it("sets forceNextUpdate", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));
      sb.clearForceFlag();
      sb.processEvent(toolEndEvent("tool-run-1", "done"));

      expect(sb.forceNextUpdate).toBe(true);
    });

    it("ignores unknown tool run_id", () => {
      const sb = makeBuilder();
      sb.processEvent(toolEndEvent("unknown-run", "result"));
      // Should not throw
      expect(sb.currentStatus.messages).toHaveLength(0);
    });

    it("handles object output with content field", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "shell"));
      sb.processEvent(toolEndEvent("tool-run-1", { content: "stdout output" }));

      const tc = sb.currentStatus.messages[0].toolCalls[0];
      expect(tc.result).toBe("stdout output");
    });
  });

  describe("unknown events", () => {
    it("silently ignores unhandled event types", () => {
      const sb = makeBuilder();
      sb.processEvent({
        event: "on_chain_start",
        run_id: "run-1",
        data: {},
      });
      expect(sb.currentStatus.messages).toHaveLength(0);
    });
  });

  describe("clearForceFlag", () => {
    it("resets forceNextUpdate to false", () => {
      const sb = makeBuilder();
      sb.processEvent(chatStreamEvent("run-1", "text"));
      sb.processEvent(toolStartEvent("tool-run-1", "read"));
      expect(sb.forceNextUpdate).toBe(true);

      sb.clearForceFlag();
      expect(sb.forceNextUpdate).toBe(false);
    });
  });
});
