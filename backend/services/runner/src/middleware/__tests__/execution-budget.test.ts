/**
 * ExecutionBudgetMiddleware: the round count, the stop it makes, and the
 * advisories before it.
 *
 * Pins what `max_tool_rounds = N` means (#1113): exactly N model responses
 * that propose tools, whatever the middleware stack; parallel calls in one
 * response are one round; a response without tool calls, or a `Command`, is
 * not a round; the stop replaces round N+1's model call (the handler is never
 * called for it) and is the typed `ToolRoundLimitError` the native turn reads
 * as `tool_call_limit`. The threshold advisory counts the same rounds, so it
 * lands at its percentage of the budget the stop enforces. Periodic mode (the
 * sub-agent stacks) keeps counting model calls and never stops. An advisory
 * is a user-role message after the request's last message, on one call only
 * (`advisory-message.ts`; until stigmer/stigmer#1354 it was a SystemMessage,
 * which Anthropic refuses mid-conversation).
 */

import { describe, it, expect, vi } from "vitest";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { createExecutionBudgetMiddleware } from "../execution-budget.js";
import { ADVISORY_LEAD_IN } from "../advisory-message.js";
import type { ModelCallRequest, StigmerMiddleware } from "../types.js";
import { ToolRoundLimitError, UNBOUNDED_ADVISORY_TOOL_ROUNDS } from "../../shared/tool-rounds.js";

type ModelResponse = AIMessage | Command;

const REQUEST: ModelCallRequest = { model: {}, messages: [], state: {}, runtime: {} };

function textResponse(content = "hello"): AIMessage {
  return new AIMessage({ content });
}

/** A response proposing `calls` tool calls: one round, however many calls. */
function toolResponse(round: number, calls = 1): AIMessage {
  return new AIMessage({
    content: `round ${round}`,
    tool_calls: Array.from({ length: calls }, (_, i) => ({ id: `call-${round}-${i}`, name: "read_file", args: { file_path: `/f${round}-${i}.md` } })),
  });
}

function handlerOf(respond: (call: number) => ModelResponse) {
  let calls = 0;
  return vi.fn(async (_request: ModelCallRequest): Promise<ModelResponse> => respond(calls++));
}

async function callModel(mw: StigmerMiddleware, handler: ReturnType<typeof handlerOf>): Promise<ModelResponse> {
  return mw.wrapModelCall!(REQUEST, handler);
}

/** The requests the handler saw that carried an advisory (the base request has no messages). */
function advisedCalls(handler: ReturnType<typeof handlerOf>): number[] {
  return handler.mock.calls.flatMap((call, index) => (call[0].messages.length > 0 ? [index] : []));
}

describe("ExecutionBudgetMiddleware", () => {
  describe("the round limit", () => {
    it("runs exactly N tool rounds, then throws ToolRoundLimitError in place of the next model call", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < 10; i++) await callModel(mw, handler);
      const stop = callModel(mw, handler);

      await expect(stop).rejects.toBeInstanceOf(ToolRoundLimitError);
      await expect(stop).rejects.toMatchObject({ toolRoundLimit: 10 });
      expect(handler, "round 11's model call never happens").toHaveBeenCalledTimes(10);
    });

    it("counts parallel tool calls in one response as one round", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call, 3));

      for (let i = 0; i < 10; i++) await callModel(mw, handler);

      await expect(callModel(mw, handler)).rejects.toBeInstanceOf(ToolRoundLimitError);
      expect(handler).toHaveBeenCalledTimes(10);
    });

    it("does not count a response without tool calls, nor a Command, as a round", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
      const handler = handlerOf((call) => (call % 3 === 0 ? toolResponse(call) : call % 3 === 1 ? textResponse() : new Command({ goto: "tools" })));

      // Calls 0, 3, …, 27 are the 10 tool rounds; the 18 between them are text
      // responses and Commands. Call 28 is the first after round 10.
      for (let i = 0; i < 28; i++) await callModel(mw, handler);

      await expect(callModel(mw, handler)).rejects.toBeInstanceOf(ToolRoundLimitError);
      expect(handler).toHaveBeenCalledTimes(28);
    });

    it("never stops an unlimited turn (maxToolRounds null, the proto's 0/unset)", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: null, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < UNBOUNDED_ADVISORY_TOOL_ROUNDS + 50; i++) await callModel(mw, handler);

      expect(handler).toHaveBeenCalledTimes(UNBOUNDED_ADVISORY_TOOL_ROUNDS + 50);
    });

    it("gives a new message a fresh budget: beforeAgent resets the count", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < 10; i++) await callModel(mw, handler);
      await expect(callModel(mw, handler)).rejects.toBeInstanceOf(ToolRoundLimitError);

      mw.beforeAgent!({}, {});
      await callModel(mw, handler);
      expect(handler).toHaveBeenCalledTimes(11);
    });

    it("rejects a non-positive limit (unlimited is null, never 0)", () => {
      expect(() => createExecutionBudgetMiddleware({ maxToolRounds: 0 })).toThrow("maxToolRounds");
    });
  });

  describe("threshold mode", () => {
    it("does not warn before the threshold", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < 8; i++) await callModel(mw, handler);

      expect(advisedCalls(handler)).toEqual([]);
      for (const call of handler.mock.calls) expect(call[0]).toBe(REQUEST);
    });

    it("warns on the model call after the threshold's tool round, with the exact rounds left", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < 9; i++) await callModel(mw, handler);

      // 80% of 10 = round 8, so the 9th call (index 8) carries the advisory.
      expect(advisedCalls(handler)).toEqual([8]);
      const advisory = handler.mock.calls[8][0].messages[0];
      expect(advisory).toMatchObject({ content: expect.stringContaining("8 of 10 tool rounds used, 2 remaining") });
    });

    it("advises with a user-role message after the request's last message, on that one call only", async () => {
      const history = [new HumanMessage("go"), toolResponse(0), new ToolMessage({ content: "ok", tool_call_id: "call-0-0" })];
      const request: ModelCallRequest = { model: {}, messages: history, state: { messages: history }, runtime: {} };
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < 10; i++) await mw.wrapModelCall!(request, handler);

      const advised = handler.mock.calls[8][0].messages;
      expect(advised.slice(0, history.length), "the history is handed on as it was").toEqual(history);
      expect(advised).toHaveLength(history.length + 1);
      const advisory = advised[history.length];
      expect(HumanMessage.isInstance(advisory)).toBe(true);
      expect(SystemMessage.isInstance(advisory), "Anthropic refuses a system message anywhere but first").toBe(false);
      expect(String((advisory as HumanMessage).content).startsWith(ADVISORY_LEAD_IN)).toBe(true);
      expect(handler.mock.calls[9][0], "the next call is handed the request untouched").toBe(request);
      expect(request.messages).toHaveLength(history.length);
    });

    it("counts tool rounds, not model calls, toward the threshold", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
      const handler = handlerOf(() => textResponse());

      for (let i = 0; i < 12; i++) await callModel(mw, handler);

      expect(advisedCalls(handler)).toEqual([]);
    });

    it("fires the warning only once", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 20, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < 20; i++) await callModel(mw, handler);

      expect(advisedCalls(handler)).toEqual([16]);
    });

    it("warns toward the unbounded advisory figure when the turn has no limit", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: null, warningPct: 80 });
      const handler = handlerOf((call) => toolResponse(call));
      const threshold = Math.floor(UNBOUNDED_ADVISORY_TOOL_ROUNDS * 0.8);

      for (let i = 0; i < threshold + 1; i++) await callModel(mw, handler);

      expect(advisedCalls(handler)).toEqual([threshold]);
    });

    it("resets on beforeAgent", async () => {
      const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 50 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < 6; i++) await callModel(mw, handler);
      mw.beforeAgent!({}, {});
      handler.mockClear();

      await callModel(mw, handler);
      expect(handler.mock.calls[0][0]).toBe(REQUEST);
    });
  });

  describe("periodic mode", () => {
    it("injects advisory every N model calls", async () => {
      const mw = createExecutionBudgetMiddleware({ warningInterval: 3, maxWarnings: 4 });
      const handler = handlerOf(() => textResponse());

      for (let i = 0; i < 12; i++) await callModel(mw, handler);

      // Advisories queued at calls 3, 6, 9, 12 (delivered at calls 4, 7, 10).
      expect(advisedCalls(handler)).toEqual([3, 6, 9]);
    });

    it("stops advising after maxWarnings", async () => {
      const mw = createExecutionBudgetMiddleware({ warningInterval: 2, maxWarnings: 2 });
      const handler = handlerOf(() => textResponse());

      for (let i = 0; i < 20; i++) await callModel(mw, handler);

      expect(advisedCalls(handler)).toHaveLength(2);
    });

    it("never stops a turn when no limit is configured (the sub-agent stacks)", async () => {
      const mw = createExecutionBudgetMiddleware({ warningInterval: 30, maxWarnings: 4 });
      const handler = handlerOf((call) => toolResponse(call));

      for (let i = 0; i < 200; i++) await callModel(mw, handler);

      expect(handler).toHaveBeenCalledTimes(200);
    });
  });

  it("rejects invalid warningPct", () => {
    expect(() => createExecutionBudgetMiddleware({ warningPct: 49 })).toThrow("warningPct");
    expect(() => createExecutionBudgetMiddleware({ warningPct: 96 })).toThrow("warningPct");
  });

  it("rejects non-positive warningInterval", () => {
    expect(() => createExecutionBudgetMiddleware({ warningInterval: 0 })).toThrow("warningInterval");
  });
});
