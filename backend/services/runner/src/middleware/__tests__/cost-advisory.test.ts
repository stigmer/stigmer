/**
 * The cost advisory: prices each model call off `usage_metadata`, keeps one
 * running total the sub-agent views share, and warns the model ONCE at the
 * configured share of `max_cost_usd`. Nothing here caps: the enforcement is
 * the turn runtime's (`shared/__tests__/cost-guard.test.ts`,
 * `harness/__tests__/run-turn.test.ts`'s cost-cap arm). Until #1096 this
 * file was `cost-cap.test.ts` and also pinned the in-graph tool block and
 * the "exceeded" message — retired with that half.
 *
 * How the warning travels (stigmer/stigmer#1354): it is priced as the model
 * answers and delivered on the NEXT model call of the graph that crossed the
 * threshold, as a user-role advisory after that request's last message. It
 * rides that one call: the following call carries none, no hook writes the
 * graph's state, and `beforeAgent` drops one still pending. The request
 * through the real Anthropic conversion is
 * `shared/__tests__/advisory-anthropic-payload.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createCostAdvisoryMiddleware } from "../cost-advisory.js";
import { ADVISORY_LEAD_IN } from "../advisory-message.js";
import type { ModelCallRequest, StigmerMiddleware } from "../types.js";

const HISTORY = [new HumanMessage("go")];
const REQUEST: ModelCallRequest = { model: {}, messages: HISTORY, state: { messages: HISTORY }, runtime: {} };

function responseWithUsage(inputTokens: number, outputTokens: number, cacheRead = 0): AIMessage {
  return new AIMessage({
    content: "response",
    usage_metadata: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      input_token_details: { cache_read: cacheRead },
    },
  });
}

/** One model call through `mw` answered with `response`; returns the request the handler was handed. */
async function callModel(mw: StigmerMiddleware, response: AIMessage): Promise<ModelCallRequest> {
  let seen: ModelCallRequest | undefined;
  await mw.wrapModelCall!(REQUEST, async (request) => {
    seen = request;
    return response;
  });
  return seen!;
}

/** The advisory text a request carries after the history, or undefined when it carries none. */
function advisoryOf(request: ModelCallRequest): string | undefined {
  const extra = request.messages.slice(HISTORY.length);
  if (extra.length === 0) return undefined;
  expect(extra).toHaveLength(1);
  return String((extra[0] as HumanMessage).content);
}

const NO_USAGE = new AIMessage({ content: "no usage" });

const BASE_CONFIG = {
  maxCostUsd: 1.0,
  inputPricePerMillion: 3.0,
  outputPricePerMillion: 15.0,
  cacheReadPricePerMillion: 0.3,
  warningPct: 80,
};

describe("CostAdvisoryMiddleware", () => {
  it("prices a model call from usage_metadata", async () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    await callModel(mw, responseWithUsage(1000, 500));
    // (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
    expect(mw.runningCost).toBeCloseTo(0.0105, 4);
  });

  it("prices cache reads at their own rate when configured", async () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    await callModel(mw, responseWithUsage(1000, 500, 600));
    // regular input 400 * 3 + cache 600 * 0.3 + output 500 * 15 = 8,880 / 1M
    expect(mw.runningCost).toBeCloseTo(0.00888, 4);
  });

  it("accumulates across model calls", async () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    await callModel(mw, responseWithUsage(1000, 500));
    await callModel(mw, responseWithUsage(2000, 1000));
    expect(mw.runningCost).toBeCloseTo(0.0315, 4);
  });

  it("skips a message without usage_metadata", async () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    await callModel(mw, NO_USAGE);
    expect(mw.runningCost).toBe(0);
  });

  it("warns once at the warning share of the cap, and never blocks a tool", async () => {
    const mw = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01, warningPct: 80 });
    // $0.0105 crosses 80% of $0.01; the warning rides the next call.
    expect(advisoryOf(await callModel(mw, responseWithUsage(1000, 500)))).toBeUndefined();
    const first = advisoryOf(await callModel(mw, responseWithUsage(100_000, 50_000)));
    expect(first).toContain("Budget warning");
    expect(first).toContain("$0.01");
    // Far past the cap: still no second warning, and no tool hook exists to block with.
    expect(advisoryOf(await callModel(mw, NO_USAGE))).toBeUndefined();
    expect(mw.wrapToolCall, "the advisory has no power over tool calls; the runtime enforces the cap").toBeUndefined();
  });

  it("delivers the warning as a user-role advisory on the next call only, never through the graph's state", async () => {
    const mw = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
    expect(mw.afterModel, "no hook writes the graph's state").toBeUndefined();

    const crossing = await callModel(mw, responseWithUsage(1000, 500));
    expect(crossing, "the crossing call itself is handed on untouched").toBe(REQUEST);

    const advised = await callModel(mw, NO_USAGE);
    const advisory = advised.messages[advised.messages.length - 1];
    expect(HumanMessage.isInstance(advisory)).toBe(true);
    expect(SystemMessage.isInstance(advisory)).toBe(false);
    expect(String((advisory as HumanMessage).content).startsWith(ADVISORY_LEAD_IN)).toBe(true);
    expect(REQUEST.messages, "the request it was built from is not mutated").toHaveLength(HISTORY.length);

    expect(await callModel(mw, NO_USAGE), "the advisory rode one call").toBe(REQUEST);
  });

  it("resets its total on beforeAgent", async () => {
    const mw = createCostAdvisoryMiddleware(BASE_CONFIG);
    await callModel(mw, responseWithUsage(1000, 500));
    mw.beforeAgent!({}, {});
    expect(mw.runningCost).toBe(0);
  });

  it("drops a warning still pending on beforeAgent: a new message starts with nothing to say", async () => {
    const mw = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
    await callModel(mw, responseWithUsage(1000, 500));
    mw.beforeAgent!({}, {});
    expect(advisoryOf(await callModel(mw, NO_USAGE))).toBeUndefined();
  });

  it("rejects a non-positive cap and a warning share outside 50–95", () => {
    expect(() => createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0 })).toThrow("maxCostUsd");
    expect(() => createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: -1 })).toThrow("maxCostUsd");
    expect(() => createCostAdvisoryMiddleware({ ...BASE_CONFIG, warningPct: 49 })).toThrow("warningPct");
    expect(() => createCostAdvisoryMiddleware({ ...BASE_CONFIG, warningPct: 96 })).toThrow("warningPct");
  });

  describe("forSubAgent", () => {
    it("advances the parent's running total", async () => {
      const parent = createCostAdvisoryMiddleware(BASE_CONFIG);
      await callModel(parent.forSubAgent(), responseWithUsage(1000, 500));
      expect(parent.runningCost).toBeCloseTo(0.0105, 4);
    });

    it("does not reset the total when the sub-agent starts", async () => {
      const parent = createCostAdvisoryMiddleware(BASE_CONFIG);
      await callModel(parent, responseWithUsage(1000, 500));
      const child = parent.forSubAgent();
      child.beforeAgent!({}, {});
      expect(parent.runningCost, "the view's beforeAgent leaves the parent's total alone").toBeCloseTo(0.0105, 4);
    });

    it("drops a warning the sub-agent's previous invocation left undelivered when it is invoked again", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      const child = parent.forSubAgent();
      // One invocation's last call crosses the threshold; the invocation ends there.
      child.beforeAgent!({}, {});
      await callModel(child, responseWithUsage(1000, 500));
      // The same view serves the sub-agent's next invocation in the turn.
      child.beforeAgent!({}, {});
      expect(advisoryOf(await callModel(child, NO_USAGE)), "no stale warning from the earlier invocation").toBeUndefined();
      expect(parent.runningCost).toBeCloseTo(0.0105, 4);
    });

    it("warns inside the sub-agent when its call crosses the parent's threshold", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      const child = parent.forSubAgent();
      await callModel(child, responseWithUsage(1000, 500));
      expect(advisoryOf(await callModel(parent, NO_USAGE)), "the parent did not cross it").toBeUndefined();
      expect(advisoryOf(await callModel(child, NO_USAGE))).toContain("Budget warning");
    });
  });
});
