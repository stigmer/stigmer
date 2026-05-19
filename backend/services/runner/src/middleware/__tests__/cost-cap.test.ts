import { describe, it, expect, vi } from "vitest";
import { ToolMessage, AIMessage } from "@langchain/core/messages";
import { createCostCapMiddleware } from "../cost-cap.js";
import type { ToolCallRequest } from "../types.js";

function makeRequest(name = "read"): ToolCallRequest {
  return {
    toolCall: { id: "tc_1", name, args: {} },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

function stateWithUsage(inputTokens: number, outputTokens: number, cacheRead = 0): Record<string, unknown> {
  const aiMsg = new AIMessage({ content: "response" });
  (aiMsg as unknown as Record<string, unknown>).usage_metadata = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    input_token_details: { cache_read: cacheRead },
  };
  return { messages: [aiMsg] };
}

const BASE_CONFIG = {
  maxCostUsd: 1.0,
  inputPricePerMillion: 3.0,
  outputPricePerMillion: 15.0,
  cacheReadPricePerMillion: 0.3,
  warningPct: 80,
};

describe("CostCapMiddleware", () => {
  it("tracks cost from usage_metadata", () => {
    const mw = createCostCapMiddleware(BASE_CONFIG);
    const state = stateWithUsage(1000, 500);

    mw.afterModel!(state, {});

    // cost = (1000 * 3 + 500 * 15) / 1_000_000 = (3000 + 7500) / 1M = 0.0105
    expect(mw.runningCost).toBeCloseTo(0.0105, 4);
    expect(mw.exceeded).toBe(false);
  });

  it("applies cache read pricing when configured", () => {
    const mw = createCostCapMiddleware(BASE_CONFIG);
    const state = stateWithUsage(1000, 500, 600);

    mw.afterModel!(state, {});

    // regular_input = 1000 - 600 = 400
    // cost = (400 * 3 + 600 * 0.3 + 500 * 15) / 1_000_000
    //      = (1200 + 180 + 7500) / 1M = 0.00888
    expect(mw.runningCost).toBeCloseTo(0.00888, 4);
  });

  it("injects warning at warning threshold", () => {
    const mw = createCostCapMiddleware({
      ...BASE_CONFIG,
      maxCostUsd: 0.01,
      warningPct: 80,
    });

    // A call costing $0.0105 exceeds 80% of $0.01 = $0.008
    const state = stateWithUsage(1000, 500);
    const result = mw.afterModel!(state, {});

    expect(result).toBeDefined();
    const messages = (result as { messages: unknown[] }).messages;
    expect(messages).toHaveLength(1);
    expect(String((messages[0] as { content: string }).content)).toContain("Budget");
  });

  it("injects exceeded message and sets exceeded flag", () => {
    const mw = createCostCapMiddleware({
      ...BASE_CONFIG,
      maxCostUsd: 0.001,
    });

    const state = stateWithUsage(1000, 500);
    const result = mw.afterModel!(state, {});

    expect(mw.exceeded).toBe(true);
    expect(result).toBeDefined();
    const messages = (result as { messages: unknown[] }).messages;
    expect(String((messages[0] as { content: string }).content)).toContain("exceeded");
  });

  it("blocks tool execution when exceeded", async () => {
    const mw = createCostCapMiddleware({
      ...BASE_CONFIG,
      maxCostUsd: 0.001,
    });

    mw.afterModel!(stateWithUsage(1000, 500), {});
    expect(mw.exceeded).toBe(true);

    const handler = vi.fn();
    const result = await mw.wrapToolCall!(makeRequest(), handler);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("Budget exceeded");
  });

  it("passes through tool calls when not exceeded", async () => {
    const mw = createCostCapMiddleware(BASE_CONFIG);
    const msg = new ToolMessage({ content: "ok", tool_call_id: "tc_1", name: "read" });
    const handler = vi.fn().mockResolvedValue(msg);

    const result = await mw.wrapToolCall!(makeRequest(), handler);
    expect(handler).toHaveBeenCalled();
    expect(result).toBe(msg);
  });

  it("resets on beforeAgent", () => {
    const mw = createCostCapMiddleware({
      ...BASE_CONFIG,
      maxCostUsd: 0.001,
    });

    mw.afterModel!(stateWithUsage(1000, 500), {});
    expect(mw.exceeded).toBe(true);

    mw.beforeAgent!({}, {});
    expect(mw.runningCost).toBe(0);
    expect(mw.exceeded).toBe(false);
  });

  it("accumulates across multiple model calls", () => {
    const mw = createCostCapMiddleware(BASE_CONFIG);

    mw.afterModel!(stateWithUsage(1000, 500), {});
    mw.afterModel!(stateWithUsage(2000, 1000), {});

    // call 1: 0.0105, call 2: (2000*3 + 1000*15)/1M = 0.021
    expect(mw.runningCost).toBeCloseTo(0.0315, 4);
  });

  it("skips messages without usage_metadata", () => {
    const mw = createCostCapMiddleware(BASE_CONFIG);
    const state = { messages: [new AIMessage({ content: "no usage" })] };

    mw.afterModel!(state, {});
    expect(mw.runningCost).toBe(0);
  });

  it("rejects non-positive maxCostUsd", () => {
    expect(() => createCostCapMiddleware({ ...BASE_CONFIG, maxCostUsd: 0 })).toThrow("maxCostUsd");
    expect(() => createCostCapMiddleware({ ...BASE_CONFIG, maxCostUsd: -1 })).toThrow("maxCostUsd");
  });

  it("rejects invalid warningPct", () => {
    expect(() => createCostCapMiddleware({ ...BASE_CONFIG, warningPct: 49 })).toThrow("warningPct");
    expect(() => createCostCapMiddleware({ ...BASE_CONFIG, warningPct: 96 })).toThrow("warningPct");
  });

  describe("forSubAgent", () => {
    it("shares cost state with parent", () => {
      const parent = createCostCapMiddleware(BASE_CONFIG);
      const child = parent.forSubAgent();

      child.afterModel!(stateWithUsage(1000, 500), {});
      expect(parent.runningCost).toBeCloseTo(0.0105, 4);
    });

    it("does not reset on beforeAgent", () => {
      const parent = createCostCapMiddleware(BASE_CONFIG);
      parent.afterModel!(stateWithUsage(1000, 500), {});

      const child = parent.forSubAgent();
      if (child.beforeAgent) child.beforeAgent({}, {});

      expect(parent.runningCost).toBeCloseTo(0.0105, 4);
    });

    it("blocks tools when parent is exceeded", async () => {
      const parent = createCostCapMiddleware({
        ...BASE_CONFIG,
        maxCostUsd: 0.001,
      });
      parent.afterModel!(stateWithUsage(1000, 500), {});

      const child = parent.forSubAgent();
      const handler = vi.fn();
      const result = await child.wrapToolCall!(makeRequest(), handler);

      expect(handler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(ToolMessage);
    });
  });
});
