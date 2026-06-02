import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeLlmCostMicros, computeTurnCost, getModelPricing, resolveModelId, ensureLoaded } from "../model-pricing.js";
import type { ModelPricing } from "../model-pricing-data.js";

describe("computeLlmCostMicros", () => {
  it("falls back to DEFAULT_PRICING when registry is not loaded", () => {
    const cost = computeLlmCostMicros("claude-sonnet-4", 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it("falls back to DEFAULT_PRICING for unknown models", () => {
    const cost = computeLlmCostMicros("unknown-model-xyz", 1000, 500);
    // DEFAULT_PRICING: input=$1.25/M, output=$6.00/M
    // (1000 * 1.25 + 500 * 6.00) / 1M = $0.00425 → 4250 micros
    expect(cost).toBe(4250);
  });

  it("returns zero when tokens are zero", () => {
    const cost = computeLlmCostMicros("any-model", 0, 0);
    expect(cost).toBe(0);
  });
});

describe("computeTurnCost", () => {
  const testPricing: ModelPricing = {
    model: "test-model",
    displayName: "Test Model",
    costTier: "standard",
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheWritePricePerMillion: 3.75,
    cacheReadPricePerMillion: 0.30,
  };

  it("computes cost from input and output tokens", () => {
    // 1000 input * $3/M = $0.003
    // 500 output * $15/M = $0.0075
    const cost = computeTurnCost(testPricing, 1000, 500, 0, 0);
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it("includes cache token costs", () => {
    const cost = computeTurnCost(testPricing, 0, 0, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3.75 + 0.30, 6);
  });

  it("returns zero for zero tokens", () => {
    const cost = computeTurnCost(testPricing, 0, 0, 0, 0);
    expect(cost).toBe(0);
  });

  it("handles large token counts", () => {
    // 1M input * $3/M = $3.00
    const cost = computeTurnCost(testPricing, 1_000_000, 0, 0, 0);
    expect(cost).toBeCloseTo(3.0, 6);
  });
});

describe("resolveModelId", () => {
  it("returns 'default' for empty string", () => {
    expect(resolveModelId("")).toBe("default");
  });

  it("returns 'default' for 'default'", () => {
    expect(resolveModelId("default")).toBe("default");
  });

  it("returns 'default' for unknown models (registry not loaded)", () => {
    expect(resolveModelId("nonexistent-model")).toBe("default");
  });
});

describe("getModelPricing", () => {
  it("returns DEFAULT_PRICING for unknown models", () => {
    const pricing = getModelPricing("some-unknown-model");
    expect(pricing.model).toBe("some-unknown-model");
    expect(pricing.inputPricePerMillion).toBe(1.25);
    expect(pricing.outputPricePerMillion).toBe(6.0);
  });

  it("overrides model field in fallback pricing", () => {
    const pricing = getModelPricing("custom-model");
    expect(pricing.model).toBe("custom-model");
  });
});
