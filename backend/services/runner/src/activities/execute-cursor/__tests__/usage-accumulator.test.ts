import { describe, it, expect } from "vitest";

import { UsageAccumulator } from "../usage-accumulator.js";

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
});
