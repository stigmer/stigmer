import { describe, it, expect, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { createExecutionBudgetMiddleware } from "../execution-budget.js";

function makeAIMessage(content = "hello"): AIMessage {
  return new AIMessage({ content });
}

describe("ExecutionBudgetMiddleware", () => {
  describe("threshold mode", () => {
    it("does not warn before threshold", async () => {
      const mw = createExecutionBudgetMiddleware({
        recursionLimit: 60,
        warningPct: 80,
      });
      // 60/6 = 10 estimated rounds, 80% = round 8
      const handler = vi.fn().mockResolvedValue(makeAIMessage());
      const request = { model: {}, messages: [], state: {}, runtime: {} } as any;

      for (let i = 0; i < 7; i++) {
        await mw.wrapModelCall!(request, handler);
      }

      // All calls should pass through without modification
      expect(handler).toHaveBeenCalledTimes(7);
      for (const call of handler.mock.calls) {
        expect(call[0]).toBe(request);
      }
    });

    it("injects warning at threshold", async () => {
      const mw = createExecutionBudgetMiddleware({
        recursionLimit: 60,
        warningPct: 80,
      });
      const handler = vi.fn().mockResolvedValue(makeAIMessage());
      const request = { model: {}, messages: [], state: {}, runtime: {} } as any;

      // Round 8 should trigger warning for round 9
      for (let i = 0; i < 8; i++) {
        await mw.wrapModelCall!(request, handler);
      }

      // Round 9 — handler should receive the advisory in messages
      await mw.wrapModelCall!(request, handler);
      const lastCall = handler.mock.calls[8][0];
      expect(lastCall.messages.length).toBeGreaterThan(0);
    });

    it("fires warning only once in threshold mode", async () => {
      const mw = createExecutionBudgetMiddleware({
        recursionLimit: 60,
        warningPct: 80,
      });
      const handler = vi.fn().mockResolvedValue(makeAIMessage());
      const request = { model: {}, messages: [], state: {}, runtime: {} } as any;

      for (let i = 0; i < 12; i++) {
        await mw.wrapModelCall!(request, handler);
      }

      // Only round 9 should have the advisory
      const callsWithAdvisory = handler.mock.calls.filter(
        (call: unknown[]) => (call[0] as { messages: unknown[] }).messages.length > 0,
      );
      expect(callsWithAdvisory.length).toBe(1);
    });
  });

  describe("periodic mode", () => {
    it("injects advisory every N rounds", async () => {
      const mw = createExecutionBudgetMiddleware({
        warningInterval: 3,
        maxWarnings: 4,
      });
      const handler = vi.fn().mockResolvedValue(makeAIMessage());
      const request = { model: {}, messages: [], state: {}, runtime: {} } as any;

      for (let i = 0; i < 12; i++) {
        await mw.wrapModelCall!(request, handler);
      }

      // Advisories queued at rounds 3, 6, 9 (delivered at rounds 4, 7, 10)
      const callsWithAdvisory = handler.mock.calls.filter(
        (call: unknown[]) => (call[0] as { messages: unknown[] }).messages.length > 0,
      );
      expect(callsWithAdvisory.length).toBeGreaterThanOrEqual(3);
    });

    it("stops after maxWarnings", async () => {
      const mw = createExecutionBudgetMiddleware({
        warningInterval: 2,
        maxWarnings: 2,
      });
      const handler = vi.fn().mockResolvedValue(makeAIMessage());
      const request = { model: {}, messages: [], state: {}, runtime: {} } as any;

      for (let i = 0; i < 20; i++) {
        await mw.wrapModelCall!(request, handler);
      }

      const callsWithAdvisory = handler.mock.calls.filter(
        (call: unknown[]) => (call[0] as { messages: unknown[] }).messages.length > 0,
      );
      expect(callsWithAdvisory.length).toBe(2);
    });
  });

  it("resets on beforeAgent", async () => {
    const mw = createExecutionBudgetMiddleware({
      recursionLimit: 18,
      warningPct: 50,
    });
    // 18/6 = 3 rounds, 50% = round 1 (min 3)
    const handler = vi.fn().mockResolvedValue(makeAIMessage());
    const request = { model: {}, messages: [], state: {}, runtime: {} } as any;

    for (let i = 0; i < 5; i++) {
      await mw.wrapModelCall!(request, handler);
    }

    mw.beforeAgent!({}, {});
    handler.mockClear();

    // After reset, first calls should not have advisory
    await mw.wrapModelCall!(request, handler);
    expect(handler.mock.calls[0][0]).toBe(request);
  });

  it("rejects invalid warningPct", () => {
    expect(() => createExecutionBudgetMiddleware({ warningPct: 49 })).toThrow("warningPct");
    expect(() => createExecutionBudgetMiddleware({ warningPct: 96 })).toThrow("warningPct");
  });

  it("rejects non-positive warningInterval", () => {
    expect(() => createExecutionBudgetMiddleware({ warningInterval: 0 })).toThrow("warningInterval");
  });
});
