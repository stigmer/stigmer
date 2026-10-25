/**
 * Pins the Claude engine's usage reports (`usage.ts`): one priced report per
 * main-loop model call, made when the call's `message_stop` arrives, from the
 * counts its `message_start` and last `message_delta` streamed.
 *
 * Why it matters: the runtime enforces the cost cap from these reports, so a
 * call counted twice overcharges, a call never counted escapes the cap, and
 * a sub-agent's stream folded into the main loop's would double its spend.
 * The counts follow the native engine's convention (`input` includes both
 * cache buckets) and the price is the shared table's over the disjoint ones.
 */

import { describe, it, expect } from "vitest";
import type { SDKMessage, SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

import { ClaudeUsage } from "../usage.js";
import type { ModelPricing } from "../../../shared/model-pricing.js";

const PRICING: ModelPricing = {
  model: "claude-sonnet-4-5",
  displayName: "Claude Sonnet 4.5",
  costTier: "standard",
  inputPricePerMillion: 3,
  outputPricePerMillion: 15,
  cacheWritePricePerMillion: 3.75,
  cacheReadPricePerMillion: 0.3,
};

type StreamEvent = SDKPartialAssistantMessage["event"];

function stream(event: StreamEvent, parent: string | null = null): SDKPartialAssistantMessage {
  return { type: "stream_event", event, parent_tool_use_id: parent, uuid: "00000000-0000-4000-8000-000000000001", session_id: "s" };
}

function start(usage: { input: number | null; cacheWrite: number | null; cacheRead: number | null; output: number }, parent: string | null = null): SDKPartialAssistantMessage {
  return stream(
    {
      type: "message_start",
      message: {
        id: "msg_1",
        usage: {
          input_tokens: usage.input,
          cache_creation_input_tokens: usage.cacheWrite,
          cache_read_input_tokens: usage.cacheRead,
          output_tokens: usage.output,
        },
      },
    } as StreamEvent,
    parent,
  );
}

function delta(output: number, parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: output } } as StreamEvent, parent);
}

function stop(parent: string | null = null): SDKPartialAssistantMessage {
  return stream({ type: "message_stop" }, parent);
}

describe("ClaudeUsage", () => {
  it("reports one priced call when its stop arrives, from its start's counts and its last delta's output", () => {
    const usage = new ClaudeUsage(PRICING, "claude-sonnet-4-5");
    expect(usage.observe(start({ input: 1000, cacheWrite: 2000, cacheRead: 4000, output: 1 }))).toBeUndefined();
    expect(usage.observe(delta(50))).toBeUndefined();
    expect(usage.observe(delta(300))).toBeUndefined();
    const report = usage.observe(stop());
    expect(report).toEqual({
      inputTokens: 7000,
      outputTokens: 300,
      cacheReadTokens: 4000,
      cacheWriteTokens: 2000,
      estimatedCostUsd: (1000 * 3 + 300 * 15 + 2000 * 3.75 + 4000 * 0.3) / 1_000_000,
      model: "claude-sonnet-4-5",
    });
  });

  it("reports a call once: a second stop with no new start reports nothing", () => {
    const usage = new ClaudeUsage(PRICING, "m");
    usage.observe(start({ input: 10, cacheWrite: 0, cacheRead: 0, output: 0 }));
    expect(usage.observe(stop())).toBeDefined();
    expect(usage.observe(stop())).toBeUndefined();
  });

  it("reports each of several calls on its own", () => {
    const usage = new ClaudeUsage(PRICING, "m");
    usage.observe(start({ input: 10, cacheWrite: 0, cacheRead: 0, output: 0 }));
    usage.observe(delta(5));
    const first = usage.observe(stop());
    usage.observe(start({ input: 20, cacheWrite: 0, cacheRead: 0, output: 0 }));
    usage.observe(delta(7));
    const second = usage.observe(stop());
    expect([first?.inputTokens, first?.outputTokens]).toEqual([10, 5]);
    expect([second?.inputTokens, second?.outputTokens]).toEqual([20, 7]);
  });

  it("keeps the start's output when no delta arrives", () => {
    const usage = new ClaudeUsage(PRICING, "m");
    usage.observe(start({ input: 1, cacheWrite: 0, cacheRead: 0, output: 4 }));
    expect(usage.observe(stop())?.outputTokens).toBe(4);
  });

  it("reads a start's absent counts as zero", () => {
    const usage = new ClaudeUsage(PRICING, "m");
    usage.observe(start({ input: null, cacheWrite: null, cacheRead: null, output: 0 }));
    expect(usage.observe(stop())).toMatchObject({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
  });

  it("ignores a delta that arrives with no call open", () => {
    const usage = new ClaudeUsage(PRICING, "m");
    expect(usage.observe(delta(99))).toBeUndefined();
    expect(usage.observe(stop())).toBeUndefined();
  });

  it("never counts a sub-agent's stream, and a sub-agent's events leave the main call untouched", () => {
    const usage = new ClaudeUsage(PRICING, "m");
    usage.observe(start({ input: 100, cacheWrite: 0, cacheRead: 0, output: 0 }));
    expect(usage.observe(start({ input: 9999, cacheWrite: 0, cacheRead: 0, output: 0 }, "toolu_agent"))).toBeUndefined();
    expect(usage.observe(delta(8888, "toolu_agent"))).toBeUndefined();
    expect(usage.observe(stop("toolu_agent"))).toBeUndefined();
    usage.observe(delta(3));
    expect(usage.observe(stop())).toMatchObject({ inputTokens: 100, outputTokens: 3 });
  });

  it("reports nothing for a message that is not a stream event, nor for other stream events", () => {
    const usage = new ClaudeUsage(PRICING, "m");
    const notStream = { type: "system", subtype: "status", status: null, uuid: "00000000-0000-4000-8000-000000000002", session_id: "s" } as SDKMessage;
    expect(usage.observe(notStream)).toBeUndefined();
    usage.observe(start({ input: 1, cacheWrite: 0, cacheRead: 0, output: 0 }));
    expect(usage.observe(stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x" } }))).toBeUndefined();
    expect(usage.observe(stop())?.inputTokens).toBe(1);
  });
});
