/**
 * max_tool_rounds resolution and the budget's stop signal.
 *
 * Pins the proto contract's arithmetic (0/unset = unlimited, the 10–1000
 * clamp and its warnings), the backstop that must never bind before the
 * round count, and the classifier the native turn uses to read a thrown
 * error as the `tool_call_limit` outcome. The classifier cases use
 * LangChain's and LangGraph's own error classes, so an engine upgrade that
 * changes how a middleware's throw reaches the turn fails here, not in a
 * production run that would otherwise read the stop as a failure.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { MiddlewareError } from "langchain";
import { GraphRecursionError } from "@langchain/langgraph";
import {
  MAX_TOOL_ROUNDS,
  MIN_TOOL_ROUNDS,
  SUPER_STEPS_BACKSTOP_PER_ROUND,
  ToolRoundLimitError,
  backstopRecursionLimit,
  isToolCallBudgetStop,
  resolveToolRoundLimit,
} from "../tool-rounds.js";

describe("resolveToolRoundLimit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for unset (proto contract: 0 = unlimited)", () => {
    expect(resolveToolRoundLimit(undefined)).toBeNull();
    expect(resolveToolRoundLimit(0)).toBeNull();
  });

  it("returns null for negative values (treated as unset, never a tiny limit)", () => {
    expect(resolveToolRoundLimit(-5)).toBeNull();
  });

  it("returns an in-range value as the round count itself", () => {
    expect(resolveToolRoundLimit(10)).toBe(10);
    expect(resolveToolRoundLimit(100)).toBe(100);
    expect(resolveToolRoundLimit(MAX_TOOL_ROUNDS)).toBe(MAX_TOOL_ROUNDS);
  });

  it("clamps below-range values up to the minimum with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveToolRoundLimit(3)).toBe(MIN_TOOL_ROUNDS);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("max_tool_rounds=3");
    expect(warn.mock.calls[0][0]).toContain("clamping to 10");
  });

  it("clamps above-range values down to the maximum with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveToolRoundLimit(5000)).toBe(MAX_TOOL_ROUNDS);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("max_tool_rounds=5000");
    expect(warn.mock.calls[0][0]).toContain("clamping to 1000");
  });

  it("does not warn for in-range values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    resolveToolRoundLimit(MIN_TOOL_ROUNDS);
    resolveToolRoundLimit(MAX_TOOL_ROUNDS);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("backstopRecursionLimit", () => {
  it("allows the backstop's super-steps per round, far above what one round costs", () => {
    expect(backstopRecursionLimit(MIN_TOOL_ROUNDS)).toBe(MIN_TOOL_ROUNDS * SUPER_STEPS_BACKSTOP_PER_ROUND);
    expect(backstopRecursionLimit(MAX_TOOL_ROUNDS)).toBe(MAX_TOOL_ROUNDS * SUPER_STEPS_BACKSTOP_PER_ROUND);
  });
});

describe("isToolCallBudgetStop", () => {
  it("reads the round count's own error as the budget's stop", () => {
    expect(isToolCallBudgetStop(new ToolRoundLimitError(10))).toBe(true);
  });

  it("reads it through LangChain's MiddlewareError wrapping, once per wrapModelCall layer", () => {
    let wrapped: unknown = new ToolRoundLimitError(10);
    for (const layer of ["ExecutionBudgetMiddleware", "todoListMiddleware", "SummarizationMiddleware"]) {
      wrapped = MiddlewareError.wrap(wrapped, layer);
    }
    expect(wrapped).toBeInstanceOf(MiddlewareError);
    expect(isToolCallBudgetStop(wrapped)).toBe(true);
  });

  it("reads the backstop's recursion error as the same stop", () => {
    expect(isToolCallBudgetStop(new GraphRecursionError("Recursion limit of 200 reached without hitting a stop condition."))).toBe(true);
  });

  it("does not read any other failure as the budget's stop, wrapped or not", () => {
    expect(isToolCallBudgetStop(new Error("upstream 529"))).toBe(false);
    expect(isToolCallBudgetStop(MiddlewareError.wrap(new Error("upstream 529"), "ExecutionBudgetMiddleware"))).toBe(false);
    expect(isToolCallBudgetStop("Recursion limit")).toBe(false);
    expect(isToolCallBudgetStop(undefined)).toBe(false);
  });
});
