import { describe, it, expect } from "vitest";
import { UsageTracker } from "../usage-tracker.js";
import { getCursorModelPricing, computeTurnCost } from "../model-pricing.js";

describe("UsageTracker", () => {
  const MODEL = "composer-2";

  describe("recordTurn", () => {
    it("returns an LlmCallMetrics proto with correct fields", () => {
      const tracker = new UsageTracker(MODEL);
      const metrics = tracker.recordTurn({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
      });

      expect(metrics.model).toBe(MODEL);
      expect(metrics.provider).toBe("cursor");
      expect(metrics.inputTokens).toBe(100);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cacheReadTokens).toBe(20);
      expect(metrics.cacheCreationTokens).toBe(10);
      expect(metrics.timestamp).toMatch(/Z$/);
    });

    it("computes totalTokens as the sum of all four buckets", () => {
      const tracker = new UsageTracker(MODEL);
      const metrics = tracker.recordTurn({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
      });

      expect(metrics.totalTokens).toBe(100 + 50 + 20 + 10);
    });

    it("stamps estimatedCostUsd matching computeTurnCost", () => {
      const tracker = new UsageTracker(MODEL);
      const pricing = getCursorModelPricing(MODEL);

      const metrics = tracker.recordTurn({
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 0,
      });

      const expected = computeTurnCost(pricing, 1000, 500, 0, 200);
      expect(metrics.estimatedCostUsd).toBeCloseTo(expected, 10);
    });
  });

  describe("sequence tracking", () => {
    it("increments sequence across turns", () => {
      const tracker = new UsageTracker(MODEL);
      const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };

      const m1 = tracker.recordTurn(usage);
      const m2 = tracker.recordTurn(usage);
      const m3 = tracker.recordTurn(usage);

      expect(m1.sequence).toBe(1);
      expect(m2.sequence).toBe(2);
      expect(m3.sequence).toBe(3);
    });

    it("reports turnCount matching recorded turns", () => {
      const tracker = new UsageTracker(MODEL);
      const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };

      expect(tracker.turnCount).toBe(0);
      tracker.recordTurn(usage);
      expect(tracker.turnCount).toBe(1);
      tracker.recordTurn(usage);
      expect(tracker.turnCount).toBe(2);
    });
  });

  describe("cumulative cost", () => {
    it("starts at zero", () => {
      const tracker = new UsageTracker(MODEL);
      expect(tracker.estimatedCostUsd).toBe(0);
    });

    it("accumulates cost across multiple turns", () => {
      const tracker = new UsageTracker(MODEL);
      const pricing = getCursorModelPricing(MODEL);

      const usage1 = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };
      const usage2 = { inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 100, cacheWriteTokens: 0 };

      tracker.recordTurn(usage1);
      tracker.recordTurn(usage2);

      const cost1 = computeTurnCost(pricing, 1000, 500, 0, 0);
      const cost2 = computeTurnCost(pricing, 2000, 1000, 0, 100);
      expect(tracker.estimatedCostUsd).toBeCloseTo(cost1 + cost2, 10);
    });

    it("uses the correct model pricing", () => {
      const premiumTracker = new UsageTracker("claude-opus-4-7");
      const economyTracker = new UsageTracker("composer-2");
      const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

      premiumTracker.recordTurn(usage);
      economyTracker.recordTurn(usage);

      expect(premiumTracker.estimatedCostUsd).toBeGreaterThan(
        economyTracker.estimatedCostUsd,
      );
    });
  });

  describe("zero-token turns", () => {
    it("handles zero tokens gracefully", () => {
      const tracker = new UsageTracker(MODEL);
      const metrics = tracker.recordTurn({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      expect(metrics.totalTokens).toBe(0);
      expect(metrics.estimatedCostUsd).toBe(0);
      expect(tracker.estimatedCostUsd).toBe(0);
    });
  });
});
