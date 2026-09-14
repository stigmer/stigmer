/**
 * The native translator's own arms: one raw LangGraph v3 protocol event in,
 * the `TranscriptEvent`s out — and, beside them, what `usageOf` reads off the
 * same wire for the loop (S4 M2 C1, Q-M2-3). The events the wire carries and
 * the transcript does not (`lifecycle`, `provider`, the standalone `usage`)
 * are pinned as producing NOTHING, so a member cannot creep back into the
 * union unnoticed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { normalize, usageOf } from "../v3-protocol-normalizer.js";
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
    it("normalizes message-start to the run id alone (the wire's message id is not a transcript fact)", () => {
      const result = normalize(makeMessageStart("run-1", { messageId: "msg_abc" }));
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        kind: "message_start",
        runId: "run-1",
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
        kind: "tool_arg_delta",
        callId: "toolu_123",
        argsChunk: '{"path":',
      });
    });

    it("normalizes message-finish to the run id alone — its usage and reason are the loop's, not the transcript's", () => {
      const result = normalize(makeMessageFinish("run-1", {
        reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      }));
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ kind: "message_finish", runId: "run-1", namespace: "" });
    });

    it("emits nothing for the standalone usage event", () => {
      expect(normalize(makeUsageEvent("run-1", { input_tokens: 50, output_tokens: 10 }))).toHaveLength(0);
    });

    it("emits nothing for the provider event", () => {
      expect(normalize(makeProviderEvent("run-1", "anthropic", "claude-sonnet-4-6"))).toHaveLength(0);
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

  // ── Usage, read beside the transcript (S4 M2 C1) ─────────────────

  describe("usageOf — what the loop reads off the wire", () => {
    it("reads a message-finish's usage, the cache buckets included", () => {
      expect(usageOf(makeMessageFinish("run-1", {
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_token_details: { cache_creation: 40, cache_read: 5 } },
      }))).toEqual({
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_token_details: { cache_creation: 40, cache_read: 5 },
      });
    });

    it("is undefined for a message-finish without usage", () => {
      expect(usageOf(makeMessageFinish("run-1"))).toBeUndefined();
    });

    it("ignores the standalone usage event — v3 emits both for one turn, and reading both would double-count", () => {
      expect(usageOf(makeUsageEvent("run-1", { input_tokens: 50, output_tokens: 10 }))).toBeUndefined();
    });

    it("reads a sub-agent's finish too — its spend is the execution's (S3 M2b, Q-M2b-1)", () => {
      expect(usageOf(makeMessageFinish("sub-run", {
        namespace: ["tools:task-1", "model_request:sub-run"],
        usage: { input_tokens: 600, output_tokens: 12 },
      }))).toMatchObject({ input_tokens: 600, output_tokens: 12 });
    });

    it("is undefined for every other channel", () => {
      expect(usageOf(makeTextDelta("run-1", "hi"))).toBeUndefined();
      expect(usageOf(makeToolFinished("toolu_abc", "ok"))).toBeUndefined();
      expect(usageOf(makeLifecycleCompleted("root"))).toBeUndefined();
    });
  });

  // ── Lifecycle channel: carried by the wire, not the transcript ───

  describe("lifecycle channel", () => {
    it("emits nothing for running", () => {
      expect(normalize(makeLifecycleRunning("root"))).toHaveLength(0);
    });

    it("emits nothing for completed", () => {
      expect(normalize(makeLifecycleCompleted("model_request", ["model_request:abc"]))).toHaveLength(0);
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

    it("carries neither seq nor node — the recorder keeps them on the raw event; no handler reads them", () => {
      const event = makeTextDelta("run-1", "hi");
      const result = normalize(event);
      expect(result[0]).not.toHaveProperty("seq");
      expect(result[0]).not.toHaveProperty("node");
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
