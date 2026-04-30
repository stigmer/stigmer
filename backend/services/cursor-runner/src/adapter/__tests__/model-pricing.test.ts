import { describe, it, expect } from "vitest";
import {
  getCursorModelPricing,
  computeTurnCost,
  type CursorModelPricing,
} from "../model-pricing.js";

describe("getCursorModelPricing", () => {
  it.each([
    "composer-2",
    "composer-1.5",
    "composer-1",
    "auto",
    "claude-4.7-opus",
    "claude-4.6-sonnet",
    "gpt-5.5",
    "gemini-3-flash",
  ])("returns pricing for known model %s", (model) => {
    const pricing = getCursorModelPricing(model);
    expect(pricing.model).toBe(model);
    expect(pricing.inputPricePerMillion).toBeGreaterThan(0);
    expect(pricing.outputPricePerMillion).toBeGreaterThan(0);
  });

  it("returns default pricing for unknown models", () => {
    const pricing = getCursorModelPricing("nonexistent-model");
    expect(pricing.model).toBe("nonexistent-model");
    expect(pricing.inputPricePerMillion).toBeGreaterThan(0);
    expect(pricing.outputPricePerMillion).toBeGreaterThan(0);
  });

  it("uses conservative default rates (auto-pool level) for unknown models", () => {
    const unknown = getCursorModelPricing("mystery-model");
    const auto = getCursorModelPricing("auto");
    expect(unknown.inputPricePerMillion).toBe(auto.inputPricePerMillion);
    expect(unknown.outputPricePerMillion).toBe(auto.outputPricePerMillion);
  });

  it("returns distinct rates for different cost tiers", () => {
    const economy = getCursorModelPricing("composer-2");
    const premium = getCursorModelPricing("claude-4.7-opus");
    expect(premium.inputPricePerMillion).toBeGreaterThan(
      economy.inputPricePerMillion,
    );
  });
});

describe("computeTurnCost", () => {
  const pricing: CursorModelPricing = {
    model: "test-model",
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 2.0,
    cacheWritePricePerMillion: 3.0,
    cacheReadPricePerMillion: 0.5,
  };

  it("computes cost from token counts and per-million rates", () => {
    const cost = computeTurnCost(pricing, 1_000_000, 0, 0, 0);
    expect(cost).toBeCloseTo(1.0, 10);
  });

  it("sums all four token buckets", () => {
    const cost = computeTurnCost(pricing, 1_000_000, 1_000_000, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.0 + 2.0 + 3.0 + 0.5, 10);
  });

  it("returns zero for zero tokens", () => {
    expect(computeTurnCost(pricing, 0, 0, 0, 0)).toBe(0);
  });

  it("handles fractional token counts correctly", () => {
    const cost = computeTurnCost(pricing, 500_000, 0, 0, 0);
    expect(cost).toBeCloseTo(0.5, 10);
  });

  it("handles realistic small turns", () => {
    const composerPricing = getCursorModelPricing("composer-2");
    const cost = computeTurnCost(composerPricing, 1000, 500, 0, 200);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.01);
  });

  it("handles large token counts without overflow", () => {
    const cost = computeTurnCost(pricing, 100_000_000, 50_000_000, 0, 0);
    expect(cost).toBeCloseTo(100 + 100, 5);
    expect(Number.isFinite(cost)).toBe(true);
  });
});
