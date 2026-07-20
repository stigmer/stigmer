// Types and pure derivations for the harness cost comparison docs component.
//
// The data contract here mirrors the curated fixture at
// `src/data/harness-cost-comparison.json`, which is generated from a cost
// benchmark report by `scripts/generate-harness-cost-comparison.ts` — never
// hand-edited. Regenerate with:
//
//   yarn generate-harness-cost-comparison --report <benchmark-report.json>
//
// This module is deliberately DOM-free so every derivation is unit-testable.
// It intentionally does NOT reuse the marketing pricing page's formatters:
// `formatUsd` there collapses everything under a cent to "< $0.01", which
// would erase benchmark costs like $0.0037 — the whole point of this page.

/** One harness's measured cell for a category: warm-state statistics plus the cold first call. */
export interface HarnessCellData {
  /** Resolved model the provider actually served (not the requested id). */
  model: string;
  /** Number of warm measured repetitions behind the median. */
  n: number;
  /** Median billable cost across the warm repetitions, in micro-USD. */
  warmBillableMicros: number;
  /** Max−min billable cost across the warm repetitions, in micro-USD. */
  spreadMicros: number;
  /** Billable cost of the cold first call (pays the prompt-cache write), or null when not measured. */
  coldBillableMicros: number | null;
  /** Cache-read share of input-side tokens on the median run (0..1). */
  cacheHitRatio: number;
  /** Total tokens (all four buckets) on the median run. */
  totalTokens: number;
  /** Wall-clock latency of the median run, in milliseconds. */
  latencyMs: number;
}

export interface ComparisonCategory {
  id: string;
  /** Human label, e.g. "Simple reply". */
  label: string;
  /**
   * "parity" cells pin both harnesses to the same model, so the cost delta
   * is pure harness overhead. "default" cells let each harness pick its
   * default model — a routed-model snapshot that drifts over time.
   */
  mode: "parity" | "default";
  native: HarnessCellData;
  cursor: HarnessCellData;
  /** Warm median cost ratio, native / cursor. Below 1 means native is cheaper. */
  warmCostRatio: number;
}

export interface HarnessCostComparisonData {
  /** UTC timestamp of the benchmark run the numbers come from. */
  runTimestamp: string;
  /** Git SHA of the benchmark suite at run time. */
  gitSha: string;
  /** Warm repetitions per cell (cold warmup excluded). */
  repsPerCell: number;
  categories: ComparisonCategory[];
}

const MICROS_PER_USD = 1_000_000;

/**
 * Formats a benchmark cost with sub-cent precision. Benchmark medians are
 * routinely fractions of a cent ($0.0037), so amounts under $1 keep four
 * decimal places; larger amounts read naturally with two.
 */
export function formatBenchmarkUsd(micros: number): string {
  const usd = micros / MICROS_PER_USD;
  if (usd === 0) return "$0";
  if (usd < 1) {
    const precise = usd.toFixed(4);
    // toFixed rounds, so 0.99995+ crosses the dollar boundary — show it as
    // a dollar amount rather than the misleading "$1.0000".
    if (precise !== "1.0000") return `$${precise}`;
  }
  return `$${usd.toFixed(2)}`;
}

/**
 * Renders the native-vs-cursor outcome as a human multiplier: a warm cost
 * ratio of 0.24 reads "4.2× cheaper", 1.8 reads "1.8× more expensive", and
 * anything within 5% of parity reads "about the same".
 */
export function describeNativeAdvantage(warmCostRatio: number): string {
  if (warmCostRatio <= 0) return "—";
  if (warmCostRatio >= 0.95 && warmCostRatio <= 1.05) return "about the same";
  if (warmCostRatio < 1) return `${(1 / warmCostRatio).toFixed(1)}× cheaper`;
  return `${warmCostRatio.toFixed(1)}× more expensive`;
}

/** Formats the run-to-run spread published alongside a median, e.g. "±$0.0002". */
export function formatSpread(spreadMicros: number): string {
  if (spreadMicros === 0) return "±$0";
  return `±${formatBenchmarkUsd(spreadMicros / 2)}`;
}

/** Formats a 0..1 cache-hit ratio as a percentage, e.g. "99%". */
export function formatCacheHit(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Formats token counts compactly: 850 → "850", 10022 → "10.0k". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

/** Formats the run timestamp as a stable, locale-independent date, e.g. "July 20, 2026". */
export function formatRunDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Width of a cost bar relative to the most expensive cell in the same
 * category row, as a 0..100 percentage. Gives the table a glanceable
 * visual without a charting dependency.
 */
export function costBarPercent(micros: number, maxMicros: number): number {
  if (maxMicros <= 0 || micros <= 0) return 0;
  return Math.max(2, Math.round((micros / maxMicros) * 100));
}

export function parityCategories(data: HarnessCostComparisonData): ComparisonCategory[] {
  return data.categories.filter((c) => c.mode === "parity");
}

export function defaultCategories(data: HarnessCostComparisonData): ComparisonCategory[] {
  return data.categories.filter((c) => c.mode === "default");
}
