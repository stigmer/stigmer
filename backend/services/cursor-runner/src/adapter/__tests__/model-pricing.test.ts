import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  getCursorModelPricing,
  computeTurnCost,
  resolveModelId,
  ensureLoaded,
  type CursorModelPricing,
} from "../model-pricing.js";

const TEST_PRICING_TABLE = vi.hoisted(() => [
  { model: "default", displayName: "Auto", costTier: "standard", inputPricePerMillion: 1.25, outputPricePerMillion: 6.0, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 },
  { model: "composer-2", displayName: "Composer 2", costTier: "standard", inputPricePerMillion: 1.25, outputPricePerMillion: 6.0, cacheWritePricePerMillion: 1.25, cacheReadPricePerMillion: 0.25 },
  { model: "composer-1.5", displayName: "Composer 1.5", costTier: "economy", inputPricePerMillion: 0.80, outputPricePerMillion: 3.0, cacheWritePricePerMillion: 0.80, cacheReadPricePerMillion: 0.15 },
  { model: "claude-opus-4-7", displayName: "Claude Opus 4.7", costTier: "premium", inputPricePerMillion: 15.0, outputPricePerMillion: 75.0, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 1.50 },
  { model: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", costTier: "standard", inputPricePerMillion: 3.0, outputPricePerMillion: 15.0, cacheWritePricePerMillion: 3.75, cacheReadPricePerMillion: 0.30 },
  { model: "gpt-5.5", displayName: "GPT-5.5", costTier: "premium", inputPricePerMillion: 10.0, outputPricePerMillion: 30.0, cacheWritePricePerMillion: 5.0, cacheReadPricePerMillion: 2.50 },
  { model: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", costTier: "economy", inputPricePerMillion: 0.40, outputPricePerMillion: 1.60, cacheWritePricePerMillion: 0.40, cacheReadPricePerMillion: 0.10 },
  { model: "gemini-3-flash", displayName: "Gemini 3 Flash", costTier: "economy", inputPricePerMillion: 0.15, outputPricePerMillion: 0.60, cacheWritePricePerMillion: 0.04, cacheReadPricePerMillion: 0.02 },
  { model: "grok-4-20", displayName: "Grok 4-20", costTier: "standard", inputPricePerMillion: 2.0, outputPricePerMillion: 10.0, cacheWritePricePerMillion: 2.0, cacheReadPricePerMillion: 0.50 },
  { model: "kimi-k2.5", displayName: "Kimi K2.5", costTier: "standard", inputPricePerMillion: 1.50, outputPricePerMillion: 6.0, cacheWritePricePerMillion: 1.50, cacheReadPricePerMillion: 0.30 },
]);

vi.mock("../model-pricing-data.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model-pricing-data.js")>();
  return {
    ...actual,
    getPricingTable: vi.fn().mockResolvedValue(TEST_PRICING_TABLE),
  };
});

beforeAll(async () => {
  await ensureLoaded();
});

describe("getCursorModelPricing", () => {
  it.each([
    "composer-2",
    "composer-1.5",
    "default",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "gpt-5.5",
    "gpt-5.4-mini",
    "gemini-3-flash",
    "grok-4-20",
    "kimi-k2.5",
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
    const auto = getCursorModelPricing("default");
    expect(unknown.inputPricePerMillion).toBe(auto.inputPricePerMillion);
    expect(unknown.outputPricePerMillion).toBe(auto.outputPricePerMillion);
  });

  it("returns distinct rates for different cost tiers", () => {
    const economy = getCursorModelPricing("composer-2");
    const premium = getCursorModelPricing("claude-opus-4-7");
    expect(premium.inputPricePerMillion).toBeGreaterThan(
      economy.inputPricePerMillion,
    );
  });
});

describe("resolveModelId", () => {
  it("returns 'default' for empty input", () => {
    expect(resolveModelId("")).toBe("default");
  });

  it("returns 'default' for 'default' input", () => {
    expect(resolveModelId("default")).toBe("default");
  });

  it("returns the model when it exists in the pricing registry", () => {
    expect(resolveModelId("composer-2")).toBe("composer-2");
    expect(resolveModelId("claude-opus-4-7")).toBe("claude-opus-4-7");
    expect(resolveModelId("gpt-5.5")).toBe("gpt-5.5");
  });

  it("falls back to 'default' for unknown models", () => {
    expect(resolveModelId("nonexistent-model")).toBe("default");
  });
});

describe("computeTurnCost", () => {
  const pricing: CursorModelPricing = {
    model: "test-model",
    displayName: "Test Model",
    costTier: "standard",
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
