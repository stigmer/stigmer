import { describe, it, expect } from "vitest";
import {
  costBarPercent,
  defaultCategories,
  describeNativeAdvantage,
  formatBenchmarkUsd,
  formatCacheHit,
  formatRunDate,
  formatSpread,
  formatTokens,
  parityCategories,
  type ComparisonCategory,
  type HarnessCostComparisonData,
} from "../harness-cost-comparison.data";

describe("formatBenchmarkUsd", () => {
  it("keeps sub-cent precision instead of collapsing to < $0.01", () => {
    // The marketing formatter would render 3700 micros as "< $0.01" —
    // useless for benchmark medians. This one must not.
    expect(formatBenchmarkUsd(3700)).toBe("$0.0037");
  });

  it("renders typical cold-call costs with four decimals", () => {
    expect(formatBenchmarkUsd(45200)).toBe("$0.0452");
  });

  it("renders zero as $0", () => {
    expect(formatBenchmarkUsd(0)).toBe("$0");
  });

  it("switches to two decimals at a dollar", () => {
    expect(formatBenchmarkUsd(1_000_000)).toBe("$1.00");
    expect(formatBenchmarkUsd(2_456_438)).toBe("$2.46");
  });

  it("renders just-under-a-dollar amounts with four decimals", () => {
    expect(formatBenchmarkUsd(999_940)).toBe("$0.9999");
  });

  it("promotes amounts that round up to a dollar into dollar formatting", () => {
    // 999,950 micros = $0.99995, which rounds to 1.0000 at four decimals —
    // "$1.00" is honest; "$1.0000" would be noise.
    expect(formatBenchmarkUsd(999_950)).toBe("$1.00");
  });
});

describe("describeNativeAdvantage", () => {
  it("inverts sub-1 ratios into a 'cheaper' multiplier", () => {
    // ratio 0.24 = native costs 24% of cursor → cursor/native = 4.2x
    expect(describeNativeAdvantage(0.24)).toBe("4.2× cheaper");
  });

  it("describes above-1 ratios as more expensive", () => {
    expect(describeNativeAdvantage(1.78)).toBe("1.8× more expensive");
  });

  it("treats within ±5% of parity as about the same", () => {
    expect(describeNativeAdvantage(0.96)).toBe("about the same");
    expect(describeNativeAdvantage(1.0)).toBe("about the same");
    expect(describeNativeAdvantage(1.05)).toBe("about the same");
  });

  it("returns a dash for missing ratios instead of Infinity", () => {
    expect(describeNativeAdvantage(0)).toBe("—");
    expect(describeNativeAdvantage(-1)).toBe("—");
  });
});

describe("formatSpread", () => {
  it("halves the max-min spread into a ± figure", () => {
    expect(formatSpread(400)).toBe("±$0.0002");
  });

  it("renders zero spread without noise", () => {
    expect(formatSpread(0)).toBe("±$0");
  });
});

describe("formatCacheHit", () => {
  it("rounds a ratio to a whole percentage", () => {
    expect(formatCacheHit(0.9997)).toBe("100%");
    expect(formatCacheHit(0.5049)).toBe("50%");
    expect(formatCacheHit(0)).toBe("0%");
  });
});

describe("formatTokens", () => {
  it("keeps small counts exact and abbreviates thousands", () => {
    expect(formatTokens(850)).toBe("850");
    expect(formatTokens(10_022)).toBe("10.0k");
    expect(formatTokens(18_761)).toBe("18.8k");
  });
});

describe("formatRunDate", () => {
  it("renders an ISO timestamp as a readable UTC date", () => {
    expect(formatRunDate("2026-07-20T12:08:07Z")).toBe("July 20, 2026");
  });

  it("falls back to the raw string for unparseable input", () => {
    expect(formatRunDate("not-a-date")).toBe("not-a-date");
  });
});

describe("costBarPercent", () => {
  it("scales against the row maximum", () => {
    expect(costBarPercent(5000, 10000)).toBe(50);
    expect(costBarPercent(10000, 10000)).toBe(100);
  });

  it("keeps tiny costs visible with a 2% floor", () => {
    expect(costBarPercent(1, 10000)).toBe(2);
  });

  it("returns 0 for zero or missing values instead of NaN", () => {
    expect(costBarPercent(0, 10000)).toBe(0);
    expect(costBarPercent(5000, 0)).toBe(0);
  });
});

describe("category filters", () => {
  const category = (id: string, mode: "parity" | "default"): ComparisonCategory => ({
    id,
    label: id,
    mode,
    warmCostRatio: 0.3,
    native: {
      model: "claude-sonnet-4-6",
      n: 5,
      warmBillableMicros: 3700,
      spreadMicros: 100,
      coldBillableMicros: 45200,
      cacheHitRatio: 0.99,
      totalTokens: 10022,
      latencyMs: 3400,
    },
    cursor: {
      model: "claude-sonnet-4-6",
      n: 5,
      warmBillableMicros: 18500,
      spreadMicros: 400,
      coldBillableMicros: 82600,
      cacheHitRatio: 0.9,
      totalTokens: 17100,
      latencyMs: 5300,
    },
  });

  const data: HarnessCostComparisonData = {
    runTimestamp: "2026-07-20T12:00:00Z",
    gitSha: "abc123def456",
    repsPerCell: 5,
    categories: [category("p1", "parity"), category("d1", "default"), category("p2", "parity")],
  };

  it("splits parity and default categories preserving order", () => {
    expect(parityCategories(data).map((c) => c.id)).toEqual(["p1", "p2"]);
    expect(defaultCategories(data).map((c) => c.id)).toEqual(["d1"]);
  });
});
