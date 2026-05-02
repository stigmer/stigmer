import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType, ToolCallStatus, ToolCallStreamingSource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { InteractionUpdate } from "@cursor/sdk";
import { DeltaEnricher } from "../delta-enricher.js";

function makeAiMessage(toolCalls: Array<{ id: string; name: string; status: ToolCallStatus }>): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content: "test",
    timestamp: "2026-05-02T12:00:00.000Z",
    toolCalls: toolCalls.map((tc) =>
      create(ToolCallSchema, {
        id: tc.id,
        name: tc.name,
        status: tc.status,
      }),
    ),
  });
}

function shellOutputDelta(event: Record<string, unknown>): InteractionUpdate {
  return { type: "shell-output-delta", event } as InteractionUpdate;
}

function toolCallStarted(callId: string, toolType: string): InteractionUpdate {
  return {
    type: "tool-call-started",
    callId,
    toolCall: { type: toolType, args: {}, result: undefined },
    modelCallId: "mc-1",
  } as InteractionUpdate;
}

function toolCallCompleted(callId: string, toolType: string): InteractionUpdate {
  return {
    type: "tool-call-completed",
    callId,
    toolCall: { type: toolType, args: {}, result: {} },
    modelCallId: "mc-1",
  } as InteractionUpdate;
}

function thinkingCompleted(durationMs: number): InteractionUpdate {
  return { type: "thinking-completed", thinkingDurationMs: durationMs } as InteractionUpdate;
}

describe("DeltaEnricher", () => {
  let enricher: DeltaEnricher;

  beforeEach(() => {
    enricher = new DeltaEnricher();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("shell-output-delta", () => {
    it("accumulates shell output and applies to matching tool call", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-1", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      ];

      enricher.processDelta(shellOutputDelta({ callId: "tc-1", type: "stdout", data: "line 1\n" }));
      enricher.processDelta(shellOutputDelta({ callId: "tc-1", type: "stdout", data: "line 2\n" }));
      enricher.applyEnrichments(messages);

      const tc = messages[0].toolCalls[0];
      expect(tc.result).toBe("line 1\nline 2\n");
      expect(tc.isStreaming).toBe(true);
      expect(tc.streamingSource).toBe(ToolCallStreamingSource.OUTPUT);
    });

    it("handles call_id variant in event payload", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-2", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      ];

      enricher.processDelta(shellOutputDelta({ call_id: "tc-2", output: "hello" }));
      enricher.applyEnrichments(messages);

      expect(messages[0].toolCalls[0].result).toBe("hello");
    });

    it("buffers output when tool call does not yet exist in messages", () => {
      const messages: AgentMessage[] = [];

      enricher.processDelta(shellOutputDelta({ callId: "tc-3", data: "buffered" }));
      const applied = enricher.applyEnrichments(messages);

      expect(applied).toBe(false);

      messages.push(
        makeAiMessage([{ id: "tc-3", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      );

      const appliedAfter = enricher.applyEnrichments(messages);
      expect(appliedAfter).toBe(true);
      expect(messages[0].toolCalls[0].result).toBe("buffered");
    });

    it("uses lastShellCallId as fallback when event has no callId", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-shell", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      ];

      enricher.processDelta(toolCallStarted("tc-shell", "shell"));
      enricher.processDelta(shellOutputDelta({ type: "stdout", data: "output without callId" }));
      enricher.applyEnrichments(messages);

      expect(messages[0].toolCalls[0].result).toBe("output without callId");
    });

    it("ignores shell output events with no text content", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-1", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      ];

      enricher.processDelta(shellOutputDelta({ callId: "tc-1", type: "exit" }));
      const applied = enricher.applyEnrichments(messages);

      expect(applied).toBe(false);
    });

    it("ignores shell output events with no identifiable callId", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-1", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      ];

      enricher.processDelta(shellOutputDelta({ type: "stdout", data: "orphan" }));
      const applied = enricher.applyEnrichments(messages);

      expect(applied).toBe(false);
    });
  });

  describe("tool-call-started / tool-call-completed timing", () => {
    it("applies startedAt from tool-call-started delta", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-1", name: "read", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      ];

      enricher.processDelta(toolCallStarted("tc-1", "read"));
      enricher.applyEnrichments(messages);

      expect(messages[0].toolCalls[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("applies completedAt from tool-call-completed delta", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-1", name: "shell", status: ToolCallStatus.TOOL_CALL_COMPLETED }]),
      ];

      enricher.processDelta(toolCallCompleted("tc-1", "shell"));
      enricher.applyEnrichments(messages);

      expect(messages[0].toolCalls[0].completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("does not overwrite existing timestamps from the stream", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-1", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      ];
      messages[0].toolCalls[0].startedAt = "2026-01-01T00:00:00.000Z";

      enricher.processDelta(toolCallStarted("tc-1", "shell"));
      enricher.applyEnrichments(messages);

      expect(messages[0].toolCalls[0].startedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("buffers timing when tool call does not yet exist", () => {
      const messages: AgentMessage[] = [];

      enricher.processDelta(toolCallStarted("tc-1", "grep"));
      enricher.applyEnrichments(messages);

      messages.push(
        makeAiMessage([{ id: "tc-1", name: "grep", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      );
      enricher.applyEnrichments(messages);

      expect(messages[0].toolCalls[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("thinking-completed", () => {
    it("logs thinking duration (no proto field mutation)", () => {
      const messages: AgentMessage[] = [
        create(AgentMessageSchema, {
          type: MessageType.MESSAGE_THINKING,
          content: "reasoning...",
          timestamp: "2026-05-02T12:00:00.000Z",
        }),
      ];
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      enricher.processDelta(thinkingCompleted(1500));
      enricher.applyEnrichments(messages);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1500ms"));
      logSpy.mockRestore();
    });
  });

  describe("isDirty and persist debouncing", () => {
    it("isDirty is false initially", () => {
      expect(enricher.isDirty).toBe(false);
    });

    it("isDirty becomes true after shell output arrives (with debounce elapsed)", () => {
      vi.setSystemTime(new Date("2026-05-02T12:00:00.000Z"));

      enricher.processDelta(shellOutputDelta({ callId: "tc-1", data: "x" }));
      expect(enricher.isDirty).toBe(true);
    });

    it("isDirty respects debounce interval after markPersisted()", () => {
      vi.setSystemTime(new Date("2026-05-02T12:00:00.000Z"));

      enricher.processDelta(shellOutputDelta({ callId: "tc-1", data: "x" }));
      enricher.markPersisted();

      enricher.processDelta(shellOutputDelta({ callId: "tc-1", data: "y" }));
      expect(enricher.isDirty).toBe(false);

      vi.advanceTimersByTime(DeltaEnricher.PERSIST_DEBOUNCE_MS);
      expect(enricher.isDirty).toBe(true);
    });

    it("tool timing does not set dirty flag", () => {
      enricher.processDelta(toolCallStarted("tc-1", "read"));
      expect(enricher.isDirty).toBe(false);
    });
  });

  describe("finalize", () => {
    it("clears is_streaming and streaming_source on all tool calls", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-1", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING }]),
      ];
      messages[0].toolCalls[0].isStreaming = true;
      messages[0].toolCalls[0].streamingSource = ToolCallStreamingSource.OUTPUT;

      enricher.finalize(messages);

      expect(messages[0].toolCalls[0].isStreaming).toBe(false);
      expect(messages[0].toolCalls[0].streamingSource).toBe(ToolCallStreamingSource.UNSPECIFIED);
    });

    it("does not affect non-streaming tool calls", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([{ id: "tc-1", name: "read", status: ToolCallStatus.TOOL_CALL_COMPLETED }]),
      ];

      enricher.finalize(messages);

      expect(messages[0].toolCalls[0].isStreaming).toBe(false);
    });
  });

  describe("multiple tool calls in sequence", () => {
    it("routes shell output to correct tool call by callId", () => {
      const messages: AgentMessage[] = [
        makeAiMessage([
          { id: "tc-1", name: "shell", status: ToolCallStatus.TOOL_CALL_COMPLETED },
          { id: "tc-2", name: "shell", status: ToolCallStatus.TOOL_CALL_RUNNING },
        ]),
      ];

      enricher.processDelta(shellOutputDelta({ callId: "tc-2", data: "second shell" }));
      enricher.applyEnrichments(messages);

      expect(messages[0].toolCalls[0].result).toBe("");
      expect(messages[0].toolCalls[1].result).toBe("second shell");
    });
  });
});
