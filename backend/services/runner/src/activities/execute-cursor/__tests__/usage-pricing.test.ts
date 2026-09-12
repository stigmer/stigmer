/**
 * The Cursor pricer: one `turn-ended` delta priced at the requested
 * variant's rates and attributed with the basis the runtime records. The
 * accounting half is `harness/__tests__/usage-accumulator.test.ts`.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { CursorUsagePricer } from "../usage-pricing.js";

// The pricer reads the worker's pricing table (model-pricing.ts); load it
// from a stubbed registry so the fast-rate assertions run against known
// prices (the model-pricing.test.ts pattern).
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
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => registry })),
  );
  process.env.STIGMER_TOKEN = "test-token";
  await (await import("../model-pricing.js")).ensureLoaded();
});

const MILLION_EACH = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

describe("CursorUsagePricer", () => {
  it("prices FAST runs at fast-variant rates, not base rates (#357)", () => {
    // Revert guard for the tier→pricing wiring: a FAST run priced at base
    // rates would understate the display estimate ~6x relative to the
    // authoritative bill. Rates from the stubbed registry: base $0.5/$2.5
    // per M, fast $3/$15 per M.
    const standard = new CursorUsagePricer("composer-2.5", ServiceTier.STANDARD).price(MILLION_EACH);
    const fast = new CursorUsagePricer("composer-2.5", ServiceTier.FAST).price(MILLION_EACH);
    expect(standard.estimatedCostUsd).toBeCloseTo(3.0, 6);
    expect(fast.estimatedCostUsd).toBeCloseTo(18.0, 6);
  });

  it("prices UNSPECIFIED at base rates (resolves to standard)", () => {
    const unspecified = new CursorUsagePricer("composer-2.5", ServiceTier.UNSPECIFIED).price(MILLION_EACH);
    const standard = new CursorUsagePricer("composer-2.5", ServiceTier.STANDARD).price(MILLION_EACH);
    expect(unspecified.estimatedCostUsd).toBe(standard.estimatedCostUsd);
  });

  it("names the basis on every priced delta: the model id and the JSON of the params sent", () => {
    const delta = new CursorUsagePricer("composer-2.5", ServiceTier.FAST, [{ id: "fast", value: "true" }]).price({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(delta.model).toBe("composer-2.5");
    expect(delta.requestedModelParams).toBe('[{"id":"fast","value":"true"}]');
    expect(delta).toMatchObject({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("names an empty params string when the runner sent none, and treats missing counts as zero", () => {
    const delta = new CursorUsagePricer("composer-2.5", ServiceTier.STANDARD, []).price({ inputTokens: 1 });
    expect(delta.requestedModelParams).toBe("");
    expect(delta.outputTokens).toBe(0);
  });
});
