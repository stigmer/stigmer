/**
 * The turn boundary at the model call: which signal refuses a call in which
 * graph, that a refused call never reaches the model, and that a halt is
 * recognised through the wraps langchain and a parent's `task` step put
 * around it (`../turn-boundary.ts`).
 */
import { describe, it, expect, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import {
  TurnBoundaryHalt,
  createTurnBoundaryMiddleware,
  haltsAtModelCall,
  isTurnBoundaryHalt,
  type TurnBoundarySignals,
} from "../turn-boundary.js";
import type { ModelCallRequest } from "../types.js";

function signals(stop = false, yieldNow = false): TurnBoundarySignals {
  const stopping = new AbortController();
  const yielding = new AbortController();
  if (stop) stopping.abort("stop");
  if (yieldNow) yielding.abort("yield");
  return { stopSignal: stopping.signal, yieldSignal: yielding.signal };
}

const REQUEST: ModelCallRequest = { model: undefined, messages: [], state: { messages: [] }, runtime: {} };

describe("haltsAtModelCall", () => {
  it("refuses nothing while the turn runs", () => {
    expect(haltsAtModelCall(signals(), "root")).toBe(false);
    expect(haltsAtModelCall(signals(), "subagent")).toBe(false);
  });

  it("refuses every graph's call after a stop", () => {
    expect(haltsAtModelCall(signals(true), "root")).toBe(true);
    expect(haltsAtModelCall(signals(true), "subagent")).toBe(true);
  });

  it("refuses only the root's call on a yield: a sub-agent's rounds are no durable boundary", () => {
    expect(haltsAtModelCall(signals(false, true), "root")).toBe(true);
    expect(haltsAtModelCall(signals(false, true), "subagent")).toBe(false);
  });
});

describe("createTurnBoundaryMiddleware", () => {
  it("hands a call the turn allows to the model", async () => {
    const answer = new AIMessage("ok");
    const handler = vi.fn(async () => answer);
    await expect(createTurnBoundaryMiddleware(signals(), "root").wrapModelCall!(REQUEST, handler)).resolves.toBe(answer);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("throws the halt for a refused call, and the model is never asked", () => {
    const handler = vi.fn(async () => new AIMessage("never"));
    expect(() => createTurnBoundaryMiddleware(signals(false, true), "root").wrapModelCall!(REQUEST, handler)).toThrow(TurnBoundaryHalt);
    expect(handler).not.toHaveBeenCalled();
  });

  it("names its graph", () => {
    expect(createTurnBoundaryMiddleware(signals(), "root").name).toBe("StigmerTurnBoundary");
    expect(createTurnBoundaryMiddleware(signals(), "subagent").name).toBe("StigmerSubAgentTurnBoundary");
  });
});

describe("isTurnBoundaryHalt", () => {
  it("recognises the halt bare and through its wraps", () => {
    const halt = new TurnBoundaryHalt("subagent");
    const wrapped = new Error(halt.message, { cause: halt });
    expect(isTurnBoundaryHalt(halt)).toBe(true);
    expect(isTurnBoundaryHalt(wrapped)).toBe(true);
    expect(isTurnBoundaryHalt(new Error("task failed", { cause: wrapped }))).toBe(true);
  });

  it("reads anything else as no halt, a cause cycle included", () => {
    const cyclic = new Error("a");
    cyclic.cause = cyclic;
    expect(isTurnBoundaryHalt(new Error("TurnBoundaryHalt"))).toBe(false);
    expect(isTurnBoundaryHalt("halted")).toBe(false);
    expect(isTurnBoundaryHalt(undefined)).toBe(false);
    expect(isTurnBoundaryHalt(cyclic)).toBe(false);
  });
});
