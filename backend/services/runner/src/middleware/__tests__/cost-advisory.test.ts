/**
 * The cost advisory: prices each model call off `usage_metadata`, keeps one
 * running total the sub-agent views share, and warns each conversation ONCE
 * after the run reaches the configured share of `max_cost_usd`. Nothing here
 * caps: the enforcement is the turn runtime's
 * (`shared/__tests__/cost-guard.test.ts`, `harness/__tests__/run-turn.test.ts`'s
 * cost-cap arm). Until #1096 this file was `cost-cap.test.ts` and also pinned
 * the in-graph tool block and the "exceeded" message — retired with that half.
 *
 * How the warning travels (stigmer/stigmer#1354): the call that takes the
 * total past the threshold marks the run crossed, and each conversation's
 * NEXT model call carries the warning, as a user-role advisory after that
 * request's last message. It rides that one call: the conversation's
 * following call carries none, no hook writes the graph's state, and the
 * parent's `beforeAgent` starts the run over (the total, the crossing, the
 * call count and the parent's own told flag), so a new message has nothing
 * to say. The request through the real Anthropic conversion is
 * `shared/__tests__/advisory-anthropic-payload.test.ts`.
 *
 * Who is told (stigmer/stigmer#1679, the `forSubAgent` cases): the parent and
 * every sub-agent conversation, once each, whichever graph's spend crossed.
 * Until then only the graph that crossed was told, so a sub-agent whose last
 * call crossed told nobody, and a parent never heard of a sub-agent's
 * crossing. The end-to-end arm is `hermetic/cost-advisory.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
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

/** The spend an advisory quotes: its first four-place dollar amount (`createWarningText`'s "consumed $…"). */
function spentIn(advisory: string | undefined): string | undefined {
  return advisory?.match(/\$(\d+\.\d{4})/)?.[1];
}

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

    it("a sub-agent invoked after the crossing is told on its first call", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      const child = parent.forSubAgent();
      // One invocation crosses the threshold and is told on its next call, then ends.
      child.beforeAgent!({}, {});
      await callModel(child, responseWithUsage(1000, 500));
      expect(advisoryOf(await callModel(child, NO_USAGE)), "the invocation that crossed").toContain("Budget warning");
      // The same view serves the sub-agent's next invocation in the turn: a new conversation, told nothing yet.
      child.beforeAgent!({}, {});
      expect(advisoryOf(await callModel(child, NO_USAGE)), "the new invocation hears it before it spends").toContain("Budget warning");
      expect(advisoryOf(await callModel(child, NO_USAGE)), "and only once").toBeUndefined();
      expect(parent.runningCost).toBeCloseTo(0.0105, 4);
    });

    it("a sub-agent's call crosses mid-task: its next call and the parent's next call each carry the warning once, and no later call does", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      const child = parent.forSubAgent();
      expect(advisoryOf(await callModel(child, responseWithUsage(1000, 500))), "the crossing call itself").toBeUndefined();
      expect(advisoryOf(await callModel(child, NO_USAGE))).toContain("Budget warning");
      expect(advisoryOf(await callModel(child, NO_USAGE)), "the sub-agent is told once").toBeUndefined();
      expect(
        advisoryOf(await callModel(parent, NO_USAGE)),
        "the parent, which decides whether to delegate again, is told too",
      ).toContain("Budget warning");
      expect(advisoryOf(await callModel(parent, NO_USAGE)), "the parent is told once").toBeUndefined();
    });

    it("a sub-agent's last call crosses the line: the parent's next call carries the warning", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      const child = parent.forSubAgent();
      expect(advisoryOf(await callModel(parent, NO_USAGE)), "the parent delegates before the crossing").toBeUndefined();
      // The sub-agent answers in one call that crosses the threshold, and makes no further call.
      child.beforeAgent!({}, {});
      await callModel(child, responseWithUsage(1000, 500));
      const advised = await callModel(parent, NO_USAGE);
      expect(advisoryOf(advised)).toContain("Budget warning");
      expect(String((advised.messages.at(-1) as HumanMessage).content).startsWith(ADVISORY_LEAD_IN)).toBe(true);
    });

    it("the parent's own call crosses the line: a sub-agent invoked afterwards is told on its first call", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      await callModel(parent, responseWithUsage(1000, 500));
      const child = parent.forSubAgent();
      child.beforeAgent!({}, {});
      expect(advisoryOf(await callModel(child, NO_USAGE)), "told before it spends").toContain("Budget warning");
      expect(advisoryOf(await callModel(parent, NO_USAGE)), "the parent, whose call crossed").toContain("Budget warning");
    });

    it("a later invocation's start does not drop the warning, and the parent is still told", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      const child = parent.forSubAgent();
      // Two invocations of one sub-agent run at once, sharing its view: the
      // first starts and crosses, then the second starts.
      child.beforeAgent!({}, {});
      await callModel(child, responseWithUsage(1000, 500));
      child.beforeAgent!({}, {});
      expect(advisoryOf(await callModel(child, NO_USAGE)), "the second start does not drop the warning").toContain("Budget warning");
      expect(advisoryOf(await callModel(parent, NO_USAGE)), "the parent is told whatever its sub-agents did").toContain("Budget warning");
    });

    it("every copy names the spend when it is read", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.1 });
      const child = parent.forSubAgent();
      // (10,000 * 3 + 4,000 * 15) / 1M = $0.09: past 80% of $0.10.
      await callModel(child, responseWithUsage(10_000, 4_000));
      // Read at $0.09; the call then spends (1,000 * 3) / 1M = $0.003 more.
      const childCopy = advisoryOf(await callModel(child, responseWithUsage(1_000, 0)));
      const parentCopy = advisoryOf(await callModel(parent, NO_USAGE));
      expect(spentIn(childCopy)).toBe("0.0900");
      expect(spentIn(parentCopy), "the parent's copy, read later, quotes the later total").toBe("0.0930");
      expect(spentIn(parentCopy)).toBe(parent.runningCost.toFixed(4));
    });

    it("two different sub-agents running at once are each told once after either crosses", async () => {
      const parent = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
      const reader = parent.forSubAgent();
      const writer = parent.forSubAgent();
      // The parent delegates to both in one message: both start, then the reader's call crosses.
      reader.beforeAgent!({}, {});
      writer.beforeAgent!({}, {});
      await callModel(reader, responseWithUsage(1000, 500));
      expect(advisoryOf(await callModel(reader, NO_USAGE)), "the sub-agent that crossed").toContain("Budget warning");
      expect(advisoryOf(await callModel(writer, NO_USAGE)), "its sibling, which has its own view").toContain("Budget warning");
      expect(advisoryOf(await callModel(reader, NO_USAGE)), "each once").toBeUndefined();
      expect(advisoryOf(await callModel(writer, NO_USAGE)), "each once").toBeUndefined();
      expect(advisoryOf(await callModel(parent, NO_USAGE)), "and the parent").toContain("Budget warning");
    });
  });

  it("prices nothing and advises no one when a call answers with a Command instead of a message", async () => {
    const mw = createCostAdvisoryMiddleware({ ...BASE_CONFIG, maxCostUsd: 0.01 });
    const jump = new Command({ goto: "__end__" });
    const answered = await mw.wrapModelCall!(REQUEST, async () => jump);
    expect(answered, "the Command is handed back untouched").toBe(jump);
    expect(mw.runningCost).toBe(0);
    expect(advisoryOf(await callModel(mw, NO_USAGE)), "nothing was crossed").toBeUndefined();
  });
});
