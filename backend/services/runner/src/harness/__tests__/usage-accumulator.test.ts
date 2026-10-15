/**
 * The runtime's usage accounting over priced deltas: the token-accounting
 * convention the Usage widget and the billing parity test depend on, the
 * audit-trail fields, and the rule that the accumulator adds and never
 * prices; and a runtime call's auxiliary cost (a eval-run try's agent
 * mock), which the estimate and the cap see while the tokens, the model and
 * the turn count stay the engine's. The pricing half is
 * `execute-cursor/__tests__/usage-pricing.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { UsageAccumulator } from "../usage-accumulator.js";
import { CostCapWatch } from "../cost-cap-watch.js";

describe("UsageAccumulator", () => {
  it("reports total_tokens as input + output (cache is a subset of input, not additive)", () => {
    const acc = new UsageAccumulator();

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
    const acc = new UsageAccumulator();
    const snap = acc.snapshot();
    expect(acc.hasTurns).toBe(false);
    expect(snap.totalTokens).toBe(0n);
    expect(snap.turnCount).toBe(0);
    expect(snap.estimatedCostUsd).toBe(0);
  });

  it("treats missing token fields as zero", () => {
    const acc = new UsageAccumulator();
    acc.addTurn({ inputTokens: 42 });
    const snap = acc.snapshot();
    expect(snap.inputTokens).toBe(42n);
    expect(snap.outputTokens).toBe(0n);
    expect(snap.totalTokens).toBe(42n);
  });

  it("sums the adapter's stated cost and never prices on its own", () => {
    const acc = new UsageAccumulator();
    acc.addTurn({ inputTokens: 1_000_000, estimatedCostUsd: 0.25 });
    acc.addTurn({ inputTokens: 1_000_000, estimatedCostUsd: 0.5 });
    acc.addTurn({ inputTokens: 1_000_000 });
    expect(acc.snapshot().estimatedCostUsd).toBeCloseTo(0.75, 9);
  });

  it("records the latest stated price basis; a delta without one inherits it (#357 audit trail)", () => {
    const acc = new UsageAccumulator(ServiceTier.FAST, ThinkingMode.DISABLED);
    acc.addTurn({ inputTokens: 10, model: "composer-2.5", requestedModelParams: '[{"id":"fast","value":"true"}]' });
    acc.addTurn({ inputTokens: 5 });
    const snap = acc.snapshot();
    expect(snap.model).toBe("composer-2.5");
    expect(snap.requestedModelParams).toBe('[{"id":"fast","value":"true"}]');
    expect(snap.requestedServiceTier).toBe(ServiceTier.FAST);
  });

  it("records an empty basis when no delta named one", () => {
    const acc = new UsageAccumulator(ServiceTier.STANDARD, ThinkingMode.DISABLED);
    acc.addTurn({ inputTokens: 1 });
    const snap = acc.snapshot();
    expect(snap.model).toBe("");
    expect(snap.requestedModelParams).toBe("");
    expect(snap.requestedServiceTier).toBe(ServiceTier.STANDARD);
  });

  it("records the requested thinking mode into the snapshot (#772 audit trail)", () => {
    const acc = new UsageAccumulator(ServiceTier.STANDARD, ThinkingMode.ENABLED);
    acc.addTurn({ inputTokens: 10, outputTokens: 5 });
    expect(acc.snapshot().requestedThinkingMode).toBe(ThinkingMode.ENABLED);
  });
});

describe("auxiliary cost", () => {
  it("adds to the estimate only, even before the engine's first delta", () => {
    const acc = new UsageAccumulator(ServiceTier.STANDARD, ThinkingMode.DISABLED);
    acc.addAuxiliaryCost(0.25);
    expect(acc.snapshot()).toMatchObject({ estimatedCostUsd: 0.25, turnCount: 0, inputTokens: 0n, model: "" });
    acc.addTurn({ inputTokens: 10, outputTokens: 2, estimatedCostUsd: 0.5, model: "m" });
    acc.addAuxiliaryCost(0.25);
    expect(acc.snapshot()).toMatchObject({ estimatedCostUsd: 1, turnCount: 1, inputTokens: 10n, model: "m" });
  });

  it("crosses the cap once, whichever kind of cost reaches it", () => {
    const watch = new CostCapWatch(1, ServiceTier.STANDARD, ThinkingMode.DISABLED);
    expect(watch.add({ estimatedCostUsd: 0.6 })).toBe(false);
    expect(watch.addAuxiliary(0.5)).toBe(true);
    expect(watch.add({ estimatedCostUsd: 0.1 })).toBe(false);
    expect(watch.addAuxiliary(0.1)).toBe(false);
  });
});
