/**
 * The cost advisory: prices each model call off `usage_metadata`, keeps one
 * running total the sub-agent views share, and warns the model ONCE at the
 * configured share of `max_cost_usd`. Nothing here caps: the enforcement is
 * the turn runtime's (`shared/__tests__/cost-guard.test.ts`,
 * `harness/__tests__/run-turn.test.ts`'s cost-cap arm). Until #1096 this
 * file was `cost-cap.test.ts` and also pinned the in-graph tool block and
 * the "exceeded" message — retired with that half.
 */

import { describe, it, expect } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { createCostAdvisoryMiddleware } from "../cost-advisory.js";

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

function warningOf(result: unknown): string | undefined {
  const messages = (result as { messages?: Array<{ content: unknown }> } | undefined)?.messages;
  return messages?.[0] ? String(messages[0].content) : undefined;
}

describe("CostAdvisoryMiddleware", () => {
  it("prices a model call from usage_metadata", () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    mw.afterModel!(stateWithUsage(1000, 500), {});
    // (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
    expect(mw.runningCost).toBeCloseTo(0.0105, 4);
  });

  it("prices cache reads at their own rate when configured", () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    mw.afterModel!(stateWithUsage(1000, 500, 600), {});
    // regular input 400 * 3 + cache 600 * 0.3 + output 500 * 15 = 8,880 / 1M
    expect(mw.runningCost).toBeCloseTo(0.00888, 4);
  });

  it("accumulates across model calls", () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    mw.afterModel!(stateWithUsage(1000, 500), {});
    mw.afterModel!(stateWithUsage(2000, 1000), {});
    expect(mw.runningCost).toBeCloseTo(0.0315, 4);
  });

  it("skips a message without usage_metadata", () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    mw.afterModel!({ messages: [new AIMessage({ content: "no usage" })] }, {});
    expect(mw.runningCost).toBe(0);
  });

  it("warns once at the warning share of the cap, and never blocks a tool", () => {
    const mw = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01, warningPct: 80 });
    // $0.0105 crosses 80% of $0.01.
    const first = warningOf(mw.afterModel!(stateWithUsage(1000, 500), {}));
    expect(first).toContain("Budget warning");
    expect(first).toContain("$0.01");
    // Far past the cap: still no second message, and no tool hook exists to block with.
    const second = mw.afterModel!(stateWithUsage(100_000, 50_000), {});
    expect(second).toBeUndefined();
    expect(mw.wrapToolCall, "the advisory has no power over tool calls; the runtime enforces the cap").toBeUndefined();
  });

  it("resets its total on beforeAgent", () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    mw.afterModel!(stateWithUsage(1000, 500), {});
    mw.beforeAgent!({}, {});
    expect(mw.runningCost).toBe(0);
  });

  it("rejects a non-positive cap and a warning share outside 50–95", () => {
    expect(() => createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0 })).toThrow("maxCostUsd");
    expect(() => createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: -1 })).toThrow("maxCostUsd");
    expect(() => createCostAdvisoryMiddleware({ ...BASE_CONFIG, warningPct: 49 })).toThrow("warningPct");
    expect(() => createCostAdvisoryMiddleware({ ...BASE_CONFIG, warningPct: 96 })).toThrow("warningPct");
  });

  describe("forSubAgent", () => {
    it("advances the parent's running total", () => {
      const parent = createCostAdvisoryMiddleware(BASE_CONFIG);
      parent.forSubAgent().afterModel!(stateWithUsage(1000, 500), {});
      expect(parent.runningCost).toBeCloseTo(0.0105, 4);
    });

    it("does not reset the total when the sub-agent starts", () => {
      const parent = createCostAdvisoryMiddleware(BASE_CONFIG);
      parent.afterModel!(stateWithUsage(1000, 500), {});
      const child = parent.forSubAgent();
      expect(child.beforeAgent, "the view has no beforeAgent on purpose").toBeUndefined();
      expect(parent.runningCost).toBeCloseTo(0.0105, 4);
    });

    it("warns inside the sub-agent when its call crosses the parent's threshold", () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      const warning = warningOf(parent.forSubAgent().afterModel!(stateWithUsage(1000, 500), {}));
      expect(warning).toContain("Budget warning");
    });
  });
});
