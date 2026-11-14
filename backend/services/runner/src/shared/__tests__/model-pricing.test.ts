/**
 * Pins the pricing lookup and cost arithmetic (`model-pricing.ts`): the turn
 * cost over disjoint token buckets, the long-prompt price step (stigmer#3131),
 * model-id resolution, the fallback pricing for an unknown model, the pricing
 * table's failure caching, and how the table parses a step.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeTurnCost, getModelPricing, resolveModelId, ensureLoaded } from "../model-pricing.js";
import {
  getPricingTable,
  _resetPricingCache,
  DEFAULT_PRICING,
  type ModelPricing,
} from "../model-pricing-data.js";

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

describe("computeTurnCost with a long-prompt step (#3131)", () => {
  // Claude Haiku 5.5's published shape: five times the rates above 100,000
  // prompt tokens, for every token class.
  const stepped: ModelPricing = {
    model: "stepped-model",
    displayName: "Stepped Model",
    costTier: "economy",
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.5,
    cacheWritePricePerMillion: 0.125,
    cacheReadPricePerMillion: 0.01,
    longContext: {
      thresholdTokens: 100_000,
      inputPricePerMillion: 0.5,
      outputPricePerMillion: 2.5,
      cacheWritePricePerMillion: 0.625,
      cacheReadPricePerMillion: 0.05,
    },
  };

  it("prices a call over the threshold at the step's rates", () => {
    expect(computeTurnCost(stepped, 150_000, 0, 0, 0)).toBeCloseTo(0.075, 9);
    expect(computeTurnCost(stepped, 150_000, 1_000, 0, 0)).toBeCloseTo(0.075 + 0.0025, 9);
  });

  it("prices a call of exactly the threshold at the base rates", () => {
    expect(computeTurnCost(stepped, 100_000, 1_000, 0, 0)).toBeCloseTo(0.01 + 0.0005, 9);
  });

  it("counts cache reads and writes toward the prompt, and steps every class", () => {
    // 40k uncached + 10k written + 60k read = 110k prompt: over the line.
    const cost = computeTurnCost(stepped, 40_000, 2_000, 10_000, 60_000);
    const expected = (40_000 * 0.5 + 2_000 * 2.5 + 10_000 * 0.625 + 60_000 * 0.05) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 9);
  });

  it("takes an explicit prompt length for counts that are not one call's", () => {
    // Output no call carried, priced at the prompt it ran beside.
    expect(computeTurnCost(stepped, 0, 1_000, 0, 0, 150_000)).toBeCloseTo(0.0025, 9);
    expect(computeTurnCost(stepped, 0, 1_000, 0, 0, 90_000)).toBeCloseTo(0.0005, 9);
  });

  it("leaves a model with no step at one rate at every length", () => {
    const flat: ModelPricing = { ...stepped, longContext: undefined };
    expect(computeTurnCost(flat, 150_000, 0, 0, 0)).toBeCloseTo(0.015, 9);
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

describe("getPricingTable failure caching (#468)", () => {
  beforeEach(() => {
    _resetPricingCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetPricingCache();
    vi.useRealTimers();
  });

  const registryResponse = () =>
    new Response(
      JSON.stringify({
        models: [
          {
            id: "claude-sonnet-4-6",
            displayName: "Claude Sonnet",
            costTier: "standard",
            pricing: {
              inputPricePerMillion: 3.0,
              outputPricePerMillion: 15.0,
              cacheWritePricePerMillion: 3.75,
              cacheReadPricePerMillion: 0.3,
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  it("retries after the short failure TTL instead of pinning DEFAULT_PRICING for an hour", async () => {
    // The model-registry.ts failure-cache policy, applied here: wrong default
    // rates for cost tracking must not persist a full success TTL.
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(registryResponse());

    // First call fails and degrades to the default table.
    expect((await getPricingTable())[0]).toBe(DEFAULT_PRICING);

    // Within the failure TTL the fallback stays cached (no refetch).
    vi.advanceTimersByTime(30_000);
    expect((await getPricingTable())[0]).toBe(DEFAULT_PRICING);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past the failure TTL the registry is refetched and real rates recover.
    vi.advanceTimersByTime(31_000);
    expect((await getPricingTable())[0]?.model).toBe("claude-sonnet-4-6");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("getPricingTable parses a long-prompt step (#3131)", () => {
  beforeEach(() => {
    _resetPricingCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetPricingCache();
  });

  const base = {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.5,
    cacheWritePricePerMillion: 0.125,
    cacheReadPricePerMillion: 0.01,
  };
  const step = {
    thresholdTokens: 100_000,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 2.5,
    cacheWritePricePerMillion: 0.625,
    cacheReadPricePerMillion: 0.05,
  };
  const serve = (longContext: unknown) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            { id: "stepped-model", displayName: "Stepped", pricing: { ...base, longContext } },
            { id: "flat-model", displayName: "Flat", pricing: base },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

  it("carries a well-formed step and leaves a flat model without one", async () => {
    serve(step);
    const table = await getPricingTable();
    expect(table.find((p) => p.model === "stepped-model")?.longContext).toEqual(step);
    expect(table.find((p) => p.model === "flat-model")?.longContext).toBeUndefined();
  });

  it.each([
    ["a zero threshold", { ...step, thresholdTokens: 0 }],
    ["a fractional threshold", { ...step, thresholdTokens: 100_000.5 }],
    ["a negative rate", { ...step, outputPricePerMillion: -1 }],
    ["a missing rate", { thresholdTokens: 100_000, inputPricePerMillion: 0.5 }],
    ["a string rate", { ...step, inputPricePerMillion: "0.5" }],
    ["a non-object", 100_000],
  ])("drops a step with %s, warns once naming the model, and keeps the base rates", async (_label, bad) => {
    serve(bad);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const table = await getPricingTable();
    const entry = table.find((p) => p.model === "stepped-model");
    expect(entry?.longContext).toBeUndefined();
    expect(entry?.inputPricePerMillion).toBe(0.1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("stepped-model");
  });
});
