// Generates src/data/harness-cost-comparison.json from a cost benchmark report.
//
// The benchmark suite (stigmer/test/integration, `make benchmark-cost` with
// the TestCostBenchmark_Report pattern) persists per-cell statistics: N warm
// repetitions, the representative (median-billable) sample, spread, and the
// cold first call. This script curates one chosen report into the fixture
// the docs component imports at build time, so the published page is always
// traceable to a specific measured run.
//
// Usage:
//   yarn generate-harness-cost-comparison --report <path-to-benchmark-report.json>
//
// Re-running the benchmark and then this script is the documented refresh
// path for the docs comparison — the fixture is never hand-edited.

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ComparisonCategory,
  HarnessCellData,
  HarnessCostComparisonData,
} from "../src/components/docs/harness-cost-comparison.data";

// --- Benchmark report shape (mirrors test/integration/harness Go structs) ---

interface BenchmarkResult {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  billable_cost_micros: number;
  latency_ms: number;
}

interface BenchmarkStat {
  n: number;
  representative: BenchmarkResult;
  billable_spread_micros: number;
  cache_hit_ratio: number;
  models: string[];
  cold_first_call?: BenchmarkResult;
}

interface BenchmarkComparison {
  scenario: string;
  native: BenchmarkStat;
  cursor: BenchmarkStat;
  cost_ratio: number;
}

interface BenchmarkReport {
  timestamp: string;
  git_sha?: string;
  comparisons: BenchmarkComparison[];
}

// --- Scenario → published category mapping ---
//
// Only report-* scenarios are published; ad-hoc spot-check scenarios in the
// suite are instrument noise from the customer's perspective. Order here is
// presentation order on the docs page.

const CATEGORY_MAP: Array<{
  scenario: string;
  id: string;
  label: string;
  mode: "parity" | "default";
}> = [
  { scenario: "report-parity-simple", id: "parity-simple", label: "Simple reply", mode: "parity" },
  { scenario: "report-parity-medium", id: "parity-medium", label: "Short explanation", mode: "parity" },
  { scenario: "report-parity-codegen", id: "parity-codegen", label: "Code generation", mode: "parity" },
  { scenario: "report-simple", id: "default-simple", label: "Simple reply", mode: "default" },
  { scenario: "report-medium", id: "default-medium", label: "Short explanation", mode: "default" },
  { scenario: "report-codegen", id: "default-codegen", label: "Code generation", mode: "default" },
];

const OUTPUT_PATH = path.resolve(process.cwd(), "src", "data", "harness-cost-comparison.json");

function toCell(stat: BenchmarkStat): HarnessCellData {
  const rep = stat.representative;
  return {
    model: rep.model,
    n: stat.n,
    warmBillableMicros: rep.billable_cost_micros,
    spreadMicros: stat.billable_spread_micros,
    coldBillableMicros: stat.cold_first_call?.billable_cost_micros ?? null,
    cacheHitRatio: stat.cache_hit_ratio,
    totalTokens: rep.total_tokens,
    latencyMs: rep.latency_ms,
  };
}

function main(): void {
  const reportArgIndex = process.argv.indexOf("--report");
  const reportPath = reportArgIndex >= 0 ? process.argv[reportArgIndex + 1] : undefined;
  if (!reportPath) {
    console.error("Usage: yarn generate-harness-cost-comparison --report <benchmark-report.json>");
    process.exit(1);
  }

  const report: BenchmarkReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const byScenario = new Map(report.comparisons.map((c) => [c.scenario, c]));

  const categories: ComparisonCategory[] = [];
  for (const mapping of CATEGORY_MAP) {
    const comparison = byScenario.get(mapping.scenario);
    if (!comparison) {
      console.warn(`warning: scenario "${mapping.scenario}" missing from report — category skipped`);
      continue;
    }
    if (comparison.native.models.length > 1 || comparison.cursor.models.length > 1) {
      console.warn(
        `warning: scenario "${mapping.scenario}" resolved multiple models mid-cell ` +
          `(native=${comparison.native.models}, cursor=${comparison.cursor.models}) — ` +
          `numbers mix models; category skipped. Re-run the benchmark.`,
      );
      continue;
    }
    categories.push({
      id: mapping.id,
      label: mapping.label,
      mode: mapping.mode,
      native: toCell(comparison.native),
      cursor: toCell(comparison.cursor),
      warmCostRatio: comparison.cost_ratio,
    });
  }

  if (categories.length === 0) {
    console.error("error: no publishable categories found in the report — fixture not written");
    process.exit(1);
  }

  const reps = Math.max(...categories.map((c) => Math.max(c.native.n, c.cursor.n)));
  const data: HarnessCostComparisonData = {
    runTimestamp: report.timestamp,
    gitSha: report.git_sha ?? "",
    repsPerCell: reps,
    categories,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}: ` +
      `${categories.length} categories from run ${report.timestamp} (${report.git_sha ?? "no sha"})`,
  );
}

main();
