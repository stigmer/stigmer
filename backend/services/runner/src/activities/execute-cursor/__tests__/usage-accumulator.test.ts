import { describe, it, expect, vi, beforeAll } from "vitest";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { UsageAccumulator } from "../usage-accumulator.js";

// The accumulator's per-turn estimate reads the worker's pricing table
// (model-pricing.ts); load it from a stubbed registry so the fast-rate
// assertions run against known prices (the model-pricing.test.ts pattern).
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

/**
 * Guards the token-accounting convention the Usage widget and the billing
 * parity test both depend on: the Cursor SDK's inputTokens already INCLUDES
 * the cached portions, so the true total is input + output. Adding the cache
 * buckets again would double-count them.
 */
describe("UsageAccumulator", () => {
  it("reports total_tokens as input + output (cache is a subset of input, not additive)", () => {
    const acc = new UsageAccumulator("claude-sonnet-4-5");

    // Two turns. cacheRead/cacheWrite are subsets of inputTokens.
    acc.addTurn({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 30, cacheWriteTokens: 10 });
    acc.addTurn({ inputTokens: 300, outputTokens: 20, cacheReadTokens: 200, cacheWriteTokens: 0 });

    const snap = acc.snapshot();

    expect(snap.inputTokens).toBe(400n);
    expect(snap.outputTokens).toBe(70n);
    expect(snap.cacheReadTokens).toBe(230n);
    expect(snap.cacheWriteTokens).toBe(10n);
    // True total = input + output = 470. NOT 470 + 230 + 10 (which would
    // double-count the cached tokens already inside inputTokens).
    expect(snap.totalTokens).toBe(470n);
    expect(snap.turnCount).toBe(2);
  });

  it("returns an empty snapshot when no turns were observed", () => {
    const acc = new UsageAccumulator("claude-sonnet-4-5");
    const snap = acc.snapshot();
    expect(snap.totalTokens).toBe(0n);
    expect(snap.turnCount).toBe(0);
  });

  it("treats missing token fields as zero", () => {
    const acc = new UsageAccumulator("claude-sonnet-4-5");
    acc.addTurn({ inputTokens: 42 });
    const snap = acc.snapshot();
    expect(snap.inputTokens).toBe(42n);
    expect(snap.outputTokens).toBe(0n);
    expect(snap.totalTokens).toBe(42n);
  });

  it("records the requested tier and params into the snapshot (#357 audit trail)", () => {
    const acc = new UsageAccumulator(
      "composer-2.5",
      ServiceTier.FAST,
      [{ id: "fast", value: "true" }],
    );
    acc.addTurn({ inputTokens: 10, outputTokens: 5 });
    const snap = acc.snapshot();
    expect(snap.requestedServiceTier).toBe(ServiceTier.FAST);
    expect(snap.requestedModelParams).toBe('[{"id":"fast","value":"true"}]');
  });

  it("records an empty params string when the runner sent none", () => {
    const acc = new UsageAccumulator("default", ServiceTier.STANDARD, []);
    acc.addTurn({ inputTokens: 1 });
    const snap = acc.snapshot();
    expect(snap.requestedServiceTier).toBe(ServiceTier.STANDARD);
    expect(snap.requestedModelParams).toBe("");
  });

  it("estimates FAST runs at fast-variant rates, not base rates (#357)", () => {
    // Revert guard for the tier→pricing wiring in addTurn: a FAST run
    // priced at base rates would understate the display estimate ~6x
    // relative to the authoritative bill. Rates from the stubbed registry:
    // base $0.5/$2.5 per M, fast $3/$15 per M.
    const turn = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

    const standard = new UsageAccumulator("composer-2.5", ServiceTier.STANDARD);
    standard.addTurn(turn);
    const fast = new UsageAccumulator("composer-2.5", ServiceTier.FAST);
    fast.addTurn(turn);

    expect(standard.snapshot().estimatedCostUsd).toBeCloseTo(3.0, 6);
    expect(fast.snapshot().estimatedCostUsd).toBeCloseTo(18.0, 6);
  });

  it("estimates UNSPECIFIED at base rates (resolves to standard)", () => {
    const turn = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

    const unspecified = new UsageAccumulator("composer-2.5");
    unspecified.addTurn(turn);
    const standard = new UsageAccumulator("composer-2.5", ServiceTier.STANDARD);
    standard.addTurn(turn);

    expect(unspecified.snapshot().estimatedCostUsd)
      .toBe(standard.snapshot().estimatedCostUsd);
  });

  it("records the requested thinking mode into the snapshot (#772 audit trail)", () => {
    const acc = new UsageAccumulator(
      "claude-haiku-4-5",
      ServiceTier.STANDARD,
      [{ id: "thinking", value: "true" }],
      ThinkingMode.ENABLED,
    );
    acc.addTurn({ inputTokens: 10, outputTokens: 5 });
    const snap = acc.snapshot();
    expect(snap.requestedThinkingMode).toBe(ThinkingMode.ENABLED);
    expect(snap.requestedModelParams).toBe('[{"id":"thinking","value":"true"}]');
  });

  it("thinking never changes the estimate — per-token price-neutral (#772)", () => {
    // Ledger-verified 2026-08-15: thinking wire ids bill exactly base
    // per-token rates; the extra cost of thinking is more output tokens,
    // which the accumulator already counts as they arrive.
    const turn = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

    const disabled = new UsageAccumulator(
      "composer-2.5", ServiceTier.STANDARD, [], ThinkingMode.DISABLED,
    );
    disabled.addTurn(turn);
    const enabled = new UsageAccumulator(
      "composer-2.5", ServiceTier.STANDARD, [], ThinkingMode.ENABLED,
    );
    enabled.addTurn(turn);

    expect(enabled.snapshot().estimatedCostUsd)
      .toBe(disabled.snapshot().estimatedCostUsd);
  });
});
