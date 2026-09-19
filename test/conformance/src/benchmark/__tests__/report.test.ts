// Unit arms for the benchmark report contract: the statistics a stat is built
// from and the reader the site script trusts a report through.
// Domain: conformance benchmark.
//
// Pinned: the median is an observed sample for odd and even counts; a null
// axis is left out of its median, never counted as zero; the cache-hit ratio
// divides by cache-inclusive input tokens; failed samples are counted and kept
// but excluded from every median; the reader refuses a wrong version, a
// missing field and a malformed side by name.
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_REPORT_SCHEMA_VERSION,
  cacheHitRatio,
  costRatio,
  median,
  medianMeasures,
  readBenchmarkReport,
  spread,
  summarize,
  type BenchmarkReport,
} from "../report";
import { makeSample } from "./sample-fixture";

describe("median and spread", () => {
  it("takes the middle sample for an odd count and the upper-middle for an even one", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(median([])).toBeNull();
  });

  it("spread is max minus min, 0 on nothing", () => {
    expect(spread([7, 2, 5])).toBe(5);
    expect(spread([])).toBe(0);
  });
});

describe("medianMeasures", () => {
  it("leaves a null axis out of its median instead of counting it as zero", () => {
    const samples = [
      makeSample({ measures: { runner_first_visible_token_ms: 300 } }),
      makeSample({ measures: { runner_first_visible_token_ms: null } }),
      makeSample({ measures: { runner_first_visible_token_ms: 500 } }),
    ];
    expect(medianMeasures(samples)?.runner_first_visible_token_ms).toBe(500);
    expect(medianMeasures([])).toBeNull();
  });

  it("medians cost and tokens per field", () => {
    const samples = [
      makeSample({ measures: { estimated_cost_micros: 100, tokens: { input: 10, output: 1, cache_read: 0, cache_write: 0, total: 11 } } }),
      makeSample({ measures: { estimated_cost_micros: 300, tokens: { input: 30, output: 3, cache_read: 0, cache_write: 0, total: 33 } } }),
      makeSample({ measures: { estimated_cost_micros: 200, tokens: { input: 20, output: 2, cache_read: 0, cache_write: 0, total: 22 } } }),
    ];
    const result = medianMeasures(samples);
    expect(result?.estimated_cost_micros).toBe(200);
    expect(result?.tokens.input).toBe(20);
  });
});

describe("cacheHitRatio", () => {
  it("divides cache-read by cache-inclusive input, so a fully cached prompt reads as 1", () => {
    const samples = [makeSample({ measures: { tokens: { input: 1000, output: 5, cache_read: 1000, cache_write: 0, total: 1005 } } })];
    expect(cacheHitRatio(samples)).toBe(1);
    expect(cacheHitRatio([])).toBe(0);
  });
});

describe("summarize", () => {
  it("counts failed attempts, keeps them, and excludes them from the medians", () => {
    const warmup = makeSample({ execution_id: "aex_warm" });
    const samples = [
      makeSample({ execution_id: "aex_1", measures: { estimated_cost_micros: 100 } }),
      makeSample({ execution_id: "aex_2", outcome: "failed", measures: { estimated_cost_micros: 9999 } }),
      makeSample({ execution_id: "aex_3", measures: { estimated_cost_micros: 300 } }),
    ];
    const stat = summarize("deep-agent", warmup, samples, null);
    expect(stat.n).toBe(2);
    expect(stat.failed).toBe(1);
    expect(stat.samples).toHaveLength(3);
    expect(stat.median?.estimated_cost_micros).toBe(300);
    expect(stat.spread.estimated_cost_micros).toBe(200);
    expect(stat.cold_first_call).toBeNull();
    expect(stat.models).toEqual(["claude-sonnet-4-6"]);
  });

  it("a cell whose every attempt failed has n 0 and a null median", () => {
    const stat = summarize("cursor", makeSample(), [makeSample({ outcome: "timeout" })], null);
    expect(stat.n).toBe(0);
    expect(stat.median).toBeNull();
    expect(costRatio(stat, stat)).toBeUndefined();
  });
});

describe("readBenchmarkReport", () => {
  function validReport(): BenchmarkReport {
    return {
      schema_version: BENCHMARK_REPORT_SCHEMA_VERSION,
      timestamp: "2026-09-19T00:00:00Z",
      git: { head_sha: "abc", main_sha: "def" },
      host: { platform: "darwin", node: "v22" },
      methodology: { reps: 5, warmup_discarded: true, cold: "first-call-of-run-per-harness-and-model", titling_suppressed: true },
      models: { parity_native: "claude-sonnet-4.6", parity_cursor: "claude-sonnet-4-6", judge_requested: "claude-sonnet-4.6" },
      comparisons: [
        {
          scenario: "report-parity-simple",
          prompts: ["Reply with exactly: hello"],
          mode: "parity",
          session_shape: "fresh-per-execution",
          native: summarize("deep-agent", makeSample(), [makeSample()], null),
        },
      ],
      quality: [],
      refused: [],
    };
  }

  it("accepts a report the producer wrote", () => {
    const report = validReport();
    expect(readBenchmarkReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("refuses a wrong schema version by value", () => {
    expect(() => readBenchmarkReport({ ...validReport(), schema_version: 1 })).toThrow("schema_version is 1");
  });

  it("refuses a missing field by name", () => {
    const report = validReport() as unknown as { git: Record<string, unknown> };
    delete report.git["main_sha"];
    expect(() => readBenchmarkReport(report)).toThrow("report.git.main_sha is missing");
  });

  it("refuses a side whose median is not a measures object", () => {
    const report = validReport();
    (report.comparisons[0]!.native as unknown as { median: unknown }).median = 42;
    expect(() => readBenchmarkReport(report)).toThrow("comparisons[0].native.median is a number");
  });

  it("refuses a body that is not an object", () => {
    expect(() => readBenchmarkReport("nope")).toThrow("report is a string");
  });
});
