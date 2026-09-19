// Generates src/data/harness-cost-comparison.json from a harness benchmark
// report.
//
// The report is produced by `make benchmark-harnesses` in the repository
// root (test/conformance/scripts/benchmark-harnesses.ts), which drives both
// harnesses against real providers and keeps every sample whole; its contract
// is test/conformance/src/benchmark/report.ts, imported here by relative path
// so the producer and this consumer read one type. This script curates one
// chosen report into the fixture the docs component imports at build time, so
// the published page is always traceable to a specific measured run: the
// report's `main_sha` (the merge base with main; a squash-merged branch SHA
// would resolve on nothing) and its timestamp.
//
// The cost the report carries is the runner's own rate-card ESTIMATE
// (`streaming_usage.estimated_cost_usd`): the open-source edition records no
// per-call billed usage. The fixture's `warmBillableMicros` carries that
// estimate, in micros; the page's copy must say so.
//
// Usage:
//   yarn generate-harness-cost-comparison [--report <path-to-report.json>]
//
// Without `--report` it reads src/data/harness-benchmark-report.json, the
// curated report checked in beside the fixture. The documented refresh path:
// run the benchmark, copy its report over that file, run this script. The
// fixture is never hand-edited.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  readBenchmarkReport,
  type BenchmarkComparison,
  type BenchmarkStat,
} from "../../test/conformance/src/benchmark/report";
import type {
  ComparisonCategory,
  HarnessCellData,
  HarnessCostComparisonData,
} from "../src/components/docs/harness-cost-comparison.data";

// --- Scenario → published category mapping ---
//
// Only these report-* scenarios are published; the turn-2 scenario and the
// quality cells are report-only until the page has a column for them. Order
// here is presentation order on the docs page.

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
const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), "src", "data", "harness-benchmark-report.json");

/** A side that ran and has a median; a refused side or one whose every attempt failed is absent. */
function presentSide(stat: BenchmarkStat | undefined): (BenchmarkStat & { median: NonNullable<BenchmarkStat["median"]> }) | undefined {
  if (stat === undefined || stat.median === null) return undefined;
  return stat as BenchmarkStat & { median: NonNullable<BenchmarkStat["median"]> };
}

function toCell(stat: BenchmarkStat & { median: NonNullable<BenchmarkStat["median"]> }): HarnessCellData {
  return {
    model: stat.models[0] ?? "",
    n: stat.n,
    warmBillableMicros: stat.median.estimated_cost_micros,
    spreadMicros: stat.spread.estimated_cost_micros,
    coldBillableMicros: stat.cold_first_call?.measures.estimated_cost_micros ?? null,
    cacheHitRatio: stat.cache_hit_ratio,
    totalTokens: stat.median.tokens.total,
    latencyMs: stat.median.end_to_end_ms ?? 0,
  };
}

function describeAbsence(comparison: BenchmarkComparison, side: "native" | "cursor"): string {
  const stat = comparison[side];
  if (stat === undefined) return "refused (see the report's `refused` list)";
  return `every attempt failed (n=0, failed=${stat.failed})`;
}

function main(): void {
  const reportArgIndex = process.argv.indexOf("--report");
  const reportPath =
    reportArgIndex >= 0 ? process.argv[reportArgIndex + 1] : DEFAULT_REPORT_PATH;
  if (!reportPath) {
    console.error("Usage: yarn generate-harness-cost-comparison [--report <benchmark-report.json>]");
    process.exit(1);
  }
  if (!fs.existsSync(reportPath)) {
    console.error(`error: no report at ${reportPath} (run \`make benchmark-harnesses\` and copy its report there)`);
    process.exit(1);
  }

  const report = readBenchmarkReport(JSON.parse(fs.readFileSync(reportPath, "utf8")));
  const byScenario = new Map(report.comparisons.map((c) => [c.scenario, c]));

  const categories: ComparisonCategory[] = [];
  for (const mapping of CATEGORY_MAP) {
    const comparison = byScenario.get(mapping.scenario);
    if (!comparison) {
      console.warn(`warning: scenario "${mapping.scenario}" missing from report — category skipped`);
      continue;
    }
    const native = presentSide(comparison.native);
    const cursor = presentSide(comparison.cursor);
    if (native === undefined || cursor === undefined) {
      const missing = native === undefined ? "native" : "cursor";
      console.warn(
        `warning: scenario "${mapping.scenario}" has no ${missing} side — ${describeAbsence(comparison, missing)} — category skipped`,
      );
      continue;
    }
    if (native.models.length > 1 || cursor.models.length > 1) {
      console.warn(
        `warning: scenario "${mapping.scenario}" resolved multiple models mid-cell ` +
          `(native=${native.models.join(",")}, cursor=${cursor.models.join(",")}) — ` +
          `numbers mix models; category skipped. Re-run the benchmark.`,
      );
      continue;
    }
    if (comparison.cost_ratio === undefined) {
      console.warn(`warning: scenario "${mapping.scenario}" has no cost ratio (a zero cursor cost) — category skipped`);
      continue;
    }
    categories.push({
      id: mapping.id,
      label: mapping.label,
      mode: mapping.mode,
      native: toCell(native),
      cursor: toCell(cursor),
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
    gitSha: report.git.main_sha,
    repsPerCell: reps,
    categories,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}: ` +
      `${categories.length} categories from run ${report.timestamp} (main ${report.git.main_sha.slice(0, 12)})`,
  );
}

main();
