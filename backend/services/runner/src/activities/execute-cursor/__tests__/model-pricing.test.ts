import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  getPricingTable,
  _resetPricingCache,
  DEFAULT_PRICING,
} from "../model-pricing-data.js";

/**
 * Verifies the cursor-runner display estimate resolves Cursor speed variants
 * (e.g. composer-2.5-fast) to the base model's fast-tier rates, mirroring the
 * authoritative cloud billing path.
 */
describe("getCursorModelPricing — speed variant resolution", () => {
  let getCursorModelPricing: typeof import("../model-pricing.js").getCursorModelPricing;
  let getCursorModelPricingForVariant: typeof import("../model-pricing.js").getCursorModelPricingForVariant;
  let computeTurnCost: typeof import("../model-pricing.js").computeTurnCost;

  beforeAll(async () => {
    const registry = {
      models: [
        {
          id: "composer-2.5",
          displayName: "Composer 2.5",
          provider: "cursor",
          harness: "cursor",
          costTier: "economy",
          pricing: {
            inputPricePerMillion: 0.5,
            outputPricePerMillion: 2.5,
            cacheWritePricePerMillion: 0,
            cacheReadPricePerMillion: 0.2,
          },
          pricingVariants: {
            fast: {
              inputPricePerMillion: 3.0,
              outputPricePerMillion: 15.0,
              cacheWritePricePerMillion: 0,
              cacheReadPricePerMillion: 0.2,
            },
          },
        },
        {
          id: "claude-opus-4-6",
          displayName: "Claude 4.6 Opus",
          provider: "anthropic",
          harness: "cursor",
          costTier: "premium",
          pricing: {
            inputPricePerMillion: 5.0,
            outputPricePerMillion: 25.0,
            cacheWritePricePerMillion: 6.25,
            cacheReadPricePerMillion: 0.5,
          },
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => registry })),
    );
    process.env.STIGMER_TOKEN = "test-token";

    const mod = await import("../model-pricing.js");
    await mod.ensureLoaded();
    getCursorModelPricing = mod.getCursorModelPricing;
    getCursorModelPricingForVariant = mod.getCursorModelPricingForVariant;
    computeTurnCost = mod.computeTurnCost;
  });

  it("resolves composer-2.5-fast to the fast tier ($3/$15)", () => {
    const p = getCursorModelPricing("composer-2.5-fast");
    expect(p.model).toBe("composer-2.5-fast");
    expect(p.inputPricePerMillion).toBe(3.0);
    expect(p.outputPricePerMillion).toBe(15.0);
    expect(p.cacheReadPricePerMillion).toBe(0.2);
  });

  it("resolves the base composer-2.5 to the standard tier ($0.5/$2.5)", () => {
    const p = getCursorModelPricing("composer-2.5");
    expect(p.inputPricePerMillion).toBe(0.5);
    expect(p.outputPricePerMillion).toBe(2.5);
  });

  it("uses base rates when a -fast model has no fast variant", () => {
    // claude-opus-4-6 has no fast variant in this stub → fall back to base.
    const p = getCursorModelPricing("claude-opus-4-6-fast");
    // No variant and no exact/normalized match → DEFAULT_PRICING (Auto pool).
    expect(p.inputPricePerMillion).toBe(1.25);
  });

  it("computeTurnCost on the fast tier reproduces the higher charge", () => {
    const p = getCursorModelPricing("composer-2.5-fast");
    // Cursor reports inputTokens inclusive of cache; regular input = 44,513.
    // (266,945 - 222,432 cache read). 44,513*$3 + 7,069*$15 + 222,432*$0.2 ≈ $0.284
    const cost = computeTurnCost(p, 266_945, 7_069, 0, 222_432);
    expect(cost).toBeCloseTo(0.28406, 5);
  });

  it("getCursorModelPricingForVariant('fast') prices a base id at fast rates (#357)", () => {
    // The explicit-tier path: the caller KNOWS the variant (it requested
    // it) — no wire-id suffix inference involved.
    const p = getCursorModelPricingForVariant("composer-2.5", "fast");
    expect(p.inputPricePerMillion).toBe(3.0);
    expect(p.outputPricePerMillion).toBe(15.0);
  });

  it("getCursorModelPricingForVariant(null) keeps base rates", () => {
    const p = getCursorModelPricingForVariant("composer-2.5", null);
    expect(p.inputPricePerMillion).toBe(0.5);
  });

  it("getCursorModelPricingForVariant('fast') falls back to base rates when unpriced", () => {
    const p = getCursorModelPricingForVariant("claude-opus-4-6", "fast");
    expect(p.inputPricePerMillion).toBe(5.0);
  });
});

describe("getPricingTable failure caching (#468)", () => {
  beforeEach(() => {
    _resetPricingCache();
  });

  afterEach(() => {
    _resetPricingCache();
    vi.useRealTimers();
  });

  it("retries after the short failure TTL instead of pinning DEFAULT_PRICING for an hour", async () => {
    // The model-registry.ts failure-cache policy, applied here: wrong default
    // rates for cost tracking must not persist a full success TTL.
    vi.useFakeTimers();
    const registryResponse = () =>
      new Response(
        JSON.stringify({
          models: [
            {
              id: "composer-2.5",
              displayName: "Composer 2.5",
              provider: "cursor",
              harness: "cursor",
              costTier: "economy",
              pricing: {
                inputPricePerMillion: 0.5,
                outputPricePerMillion: 2.5,
                cacheWritePricePerMillion: 0,
                cacheReadPricePerMillion: 0.2,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(registryResponse());
    vi.stubGlobal("fetch", fetchSpy);

    // First call fails and degrades to the default table.
    expect((await getPricingTable())[0]).toBe(DEFAULT_PRICING);

    // Within the failure TTL the fallback stays cached (no refetch).
    vi.advanceTimersByTime(30_000);
    expect((await getPricingTable())[0]).toBe(DEFAULT_PRICING);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past the failure TTL the registry is refetched and real rates recover.
    vi.advanceTimersByTime(31_000);
    expect((await getPricingTable())[0]?.model).toBe("composer-2.5");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
