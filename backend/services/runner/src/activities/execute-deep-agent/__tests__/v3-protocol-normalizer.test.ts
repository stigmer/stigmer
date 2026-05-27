import { describe, it, expect, beforeEach } from "vitest";
import { normalize } from "../v3-protocol-normalizer.js";
import {
  resetSeq,
  makeProtocolEvent,
  makeMessageStart,
  makeMessageFinish,
  makeTextDelta,
  makeReasoningDelta,
  makeToolCallArgDelta,
  makeToolStarted,
  makeToolFinished,
  makeToolError,
  makeToolOutputDelta,
  makeUsageEvent,
  makeProviderEvent,
  makeLifecycleRunning,
  makeLifecycleCompleted,
  makeContentBlockStartText,
  makeContentBlockFinish,
  makeCheckpointEvent,
  makeTasksEvent,
  makeValuesEvent,
  makeUpdatesEvent,
} from "../__test-utils__/v3-event-fixtures.js";

beforeEach(() => resetSeq());

describe("V3ProtocolNormalizer", () => {

  // ── Message channel ──────────────────────────────────────────────

  describe("messages channel", () => {
    it("normalizes message-start", () => {
      const result = normalize(makeMessageStart("run-1", { messageId: "msg_abc" }));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "message_start",
        runId: "run-1",
        messageId: "msg_abc",
        namespace: "",
      });
    });

    it("normalizes text-delta", () => {
      const result = normalize(makeTextDelta("run-1", "Hello "));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "text_delta",
        runId: "run-1",
        text: "Hello ",
      });
    });

    it("normalizes reasoning-delta", () => {
      const result = normalize(makeReasoningDelta("run-1", "Let me think..."));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "reasoning_delta",
        runId: "run-1",
        text: "Let me think...",
      });
    });

    it("normalizes tool_call_chunk via block-delta", () => {
      const result = normalize(makeToolCallArgDelta("run-1", "toolu_123", '{"path":'));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_call_arg_delta",
        callId: "toolu_123",
        argsChunk: '{"path":',
      });
    });

    it("normalizes message-finish with usage", () => {
      const result = normalize(makeMessageFinish("run-1", {
        reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      }));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "message_finish",
        runId: "run-1",
        reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
        },
      });
    });

    it("normalizes message-finish without usage", () => {
      const result = normalize(makeMessageFinish("run-1"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "message_finish",
        runId: "run-1",
        usage: undefined,
      });
    });

    it("normalizes usage event", () => {
      const result = normalize(makeUsageEvent("run-1", {
        input_tokens: 50, output_tokens: 10,
        input_token_details: { cache_creation: 40, cache_read: 5 },
      }));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "usage",
        usage: {
          input_tokens: 50,
          output_tokens: 10,
          input_token_details: { cache_creation: 40, cache_read: 5 },
        },
      });
    });

    it("normalizes provider event with model", () => {
      const result = normalize(makeProviderEvent("run-1", "anthropic", "claude-sonnet-4-6"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "provider",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });
    });

    it("returns empty for content-block-start", () => {
      const result = normalize(makeContentBlockStartText("run-1"));
      expect(result).toHaveLength(0);
    });

    it("returns empty for content-block-finish", () => {
      const result = normalize(makeContentBlockFinish("run-1"));
      expect(result).toHaveLength(0);
    });

    it("ignores empty text-delta", () => {
      const result = normalize(makeTextDelta("run-1", ""));
      expect(result).toHaveLength(0);
    });

    it("ignores empty reasoning-delta", () => {
      const result = normalize(makeReasoningDelta("run-1", ""));
      expect(result).toHaveLength(0);
    });
  });

  // ── Tools channel ────────────────────────────────────────────────

  describe("tools channel", () => {
    it("normalizes tool-started with snake_case fields", () => {
      const result = normalize(makeToolStarted("toolu_abc", "read_file", '{"path":"/src/main.ts"}'));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_started",
        callId: "toolu_abc",
        name: "read_file",
        input: { path: "/src/main.ts" },
      });
    });

    it("normalizes tool-started with camelCase fields", () => {
      const event = makeProtocolEvent("tools", {
        event: "tool-started",
        toolCallId: "toolu_abc",
        toolName: "read_file",
        input: { path: "/src/main.ts" },
      }, { namespace: ["tools:toolu_abc"] });
      const result = normalize(event);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_started",
        callId: "toolu_abc",
        name: "read_file",
      });
    });

    it("normalizes tool-finished", () => {
      const result = normalize(makeToolFinished("toolu_abc", "file content here"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_finished",
        callId: "toolu_abc",
      });
    });

    it("normalizes tool-error", () => {
      const result = normalize(makeToolError("toolu_abc", "permission denied"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_error",
        callId: "toolu_abc",
        message: "permission denied",
      });
    });

    it("normalizes tool-output-delta", () => {
      const result = normalize(makeToolOutputDelta("toolu_abc", "partial output"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "tool_output_delta",
        callId: "toolu_abc",
        delta: "partial output",
      });
    });

    it("parses string JSON input into object", () => {
      const result = normalize(makeToolStarted("toolu_abc", "think", '{"thought":"test"}'));
      expect(result[0]).toMatchObject({
        kind: "tool_started",
        input: { thought: "test" },
      });
    });

    it("handles malformed JSON input gracefully", () => {
      const result = normalize(makeToolStarted("toolu_abc", "think", "not json"));
      expect(result[0]).toMatchObject({
        kind: "tool_started",
        input: {},
      });
    });
  });

  // ── Lifecycle channel ────────────────────────────────────────────

  describe("lifecycle channel", () => {
    it("normalizes running event", () => {
      const result = normalize(makeLifecycleRunning("root"));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "lifecycle",
        event: "running",
        graphName: "root",
      });
    });

    it("normalizes completed event", () => {
      const result = normalize(makeLifecycleCompleted("model_request", ["model_request:abc"]));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "lifecycle",
        event: "completed",
        graphName: "model_request",
        namespace: "model_request:abc",
      });
    });
  });

  // ── Ignored channels ─────────────────────────────────────────────

  describe("ignored channels", () => {
    it("returns empty for checkpoints", () => {
      expect(normalize(makeCheckpointEvent())).toHaveLength(0);
    });

    it("returns empty for tasks", () => {
      expect(normalize(makeTasksEvent())).toHaveLength(0);
    });

    it("returns empty for values", () => {
      expect(normalize(makeValuesEvent())).toHaveLength(0);
    });

    it("returns empty for updates", () => {
      expect(normalize(makeUpdatesEvent())).toHaveLength(0);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns empty for unknown method", () => {
      const event = makeProtocolEvent("input", { event: "something" });
      expect(normalize(event)).toHaveLength(0);
    });

    it("returns empty for missing data", () => {
      const event = makeProtocolEvent("messages", undefined);
      expect(normalize(event)).toHaveLength(0);
    });

    it("returns empty for unknown message event type", () => {
      const event = makeProtocolEvent("messages", { event: "brand-new-thing", run_id: "r" });
      expect(normalize(event)).toHaveLength(0);
    });

    it("preserves namespace from event params", () => {
      const result = normalize(makeTextDelta("run-1", "hi", { namespace: ["subagent:worker-1"] }));
      expect(result[0]).toMatchObject({ namespace: "subagent:worker-1" });
    });

    it("joins multi-segment namespace with pipe", () => {
      const result = normalize(makeTextDelta("run-1", "hi", { namespace: ["a", "b"] }));
      expect(result[0]).toMatchObject({ namespace: "a|b" });
    });

    it("preserves seq from original event", () => {
      const event = makeTextDelta("run-1", "hi");
      const result = normalize(event);
      expect(result[0].seq).toBe(event.seq);
    });

    it("handles delta with no type gracefully", () => {
      const event = makeProtocolEvent("messages", {
        event: "content-block-delta",
        index: 0,
        delta: {},
        run_id: "run-1",
      });
      expect(normalize(event)).toHaveLength(0);
    });

    it("handles missing tool_call_id in tool-started", () => {
      const event = makeProtocolEvent("tools", {
        event: "tool-started",
        tool_name: "read_file",
      }, { namespace: ["tools:abc"] });
      const result = normalize(event);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ kind: "tool_started", callId: "" });
    });
  });
});
