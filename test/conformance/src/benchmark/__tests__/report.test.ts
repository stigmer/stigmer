// Unit arms for the benchmark report contract: the statistics a stat is built
// from and the reader a tool outside this workspace trusts a report through.
// Domain: conformance benchmark.
//
// Pinned: the median is an observed sample for odd and even counts; a null
// axis is left out of its median, never counted as zero; the cache-hit ratio
// divides by cache-inclusive input tokens; failed samples are counted and kept
// but excluded from every median; the reader accepts a report with or
// without the quality eval and refuses a wrong version, a missing field, a
// malformed side, a quality eval without its document object, a native
// arm without its endpoint, API or cost basis, and a v8 report without the
// measured code's SHA or the runner's marker counts by name.
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
import { emptyMarkers } from "../log-markers";
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
      git: { head_sha: "abc", main_sha: "def", code_sha: "abc" },
      host: { platform: "darwin", node: "v22" },
      methodology: {
        reps: 5,
        quality_reps: 3,
        warmup_discarded: true,
        cold: "first-call-of-run-per-harness-model-and-agent",
        titling_suppressed: true,
        file_review: "approved-at-review-ready",
        shell_background: "on",
      },
      models: {
        parity_native: "claude-sonnet-4.6",
        parity_cursor: "claude-sonnet-4-6",
        judge_requested: "claude-sonnet-4.6",
        native_endpoint: "api.anthropic.com",
        native_api: "messages",
        native_cost_basis: "catalog",
      },
      comparisons: [
        {
          scenario: "report-parity-simple",
          prompts: ["Reply with exactly: hello"],
          mode: "parity",
          session_shape: "fresh-per-execution",
          agent: "bare",
          native: summarize("deep-agent", makeSample(), [makeSample()], null),
        },
      ],
      quality: {
        plugin: "working-agent",
        eval_id: "pev_1",
        targets: ["native/claude-sonnet-4.6"],
        judge_model: "claude-sonnet-4.6",
        runs: 3,
        document: { schemaVersion: 1, cases: [] },
      },
      refused: [],
      runner_log: { ...emptyMarkers(), files: ["runner.log"], truncated: { kept_yes: 1, kept_no: 0, kept_absent: 0, by_tool: { read_file: 1 } } },
    };
  }

  it("accepts a report the producer wrote", () => {
    const report = validReport();
    expect(readBenchmarkReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("refuses a wrong schema version by value, the v2 reports before the working agent included", () => {
    expect(() => readBenchmarkReport({ ...validReport(), schema_version: 2 })).toThrow("schema_version is 2");
  });

  it("accepts a report with no quality eval, and one whose eval failed before its document", () => {
    expect(readBenchmarkReport({ ...validReport(), quality: null }).quality).toBeNull();
    const failed = validReport();
    failed.quality = { ...failed.quality!, document: null, failure: { stage: "create", message: "push failed" } };
    expect(readBenchmarkReport(failed).quality?.failure?.stage).toBe("create");
  });

  it("refuses a report without the quality eval, a document that is not an object, or the comparison's agent", () => {
    const withoutQuality = validReport() as unknown as Record<string, unknown>;
    delete withoutQuality["quality"];
    expect(() => readBenchmarkReport(withoutQuality)).toThrow("report.quality is missing");
    const badDocument = validReport();
    (badDocument.quality as unknown as { document: unknown }).document = [];
    expect(() => readBenchmarkReport(badDocument)).toThrow("report.quality.document is an array");
    const withoutAgent = validReport();
    delete (withoutAgent.comparisons[0] as unknown as Record<string, unknown>)["agent"];
    expect(() => readBenchmarkReport(withoutAgent)).toThrow("report.comparisons[0].agent is missing");
  });

  it("refuses a report without the native arm's endpoint, API or cost basis, the v7 reports before one arm per run", () => {
    for (const key of ["native_endpoint", "native_api", "native_cost_basis"]) {
      const report = validReport();
      delete (report.models as unknown as Record<string, unknown>)[key];
      expect(() => readBenchmarkReport(report), key).toThrow(`report.models.${key} is missing`);
    }
    const unknownApi = validReport();
    (unknownApi.models as unknown as Record<string, unknown>)["native_api"] = "grpc";
    expect(() => readBenchmarkReport(unknownApi)).toThrow(
      'report.models.native_api is "grpc", expected one of messages, chat-completions, responses',
    );
    const unknownBasis = validReport();
    (unknownBasis.models as unknown as Record<string, unknown>)["native_cost_basis"] = 3;
    expect(() => readBenchmarkReport(unknownBasis)).toThrow("report.models.native_cost_basis is a number");
    const noModels = validReport() as unknown as Record<string, unknown>;
    delete noModels["models"];
    expect(() => readBenchmarkReport(noModels)).toThrow("report.models is missing");
    expect(() => readBenchmarkReport({ ...validReport(), schema_version: 7 })).toThrow("schema_version is 7");
  });

  it("refuses the v8 reports before the measured code and the runner log, and either field missing, by name", () => {
    expect(() => readBenchmarkReport({ ...validReport(), schema_version: 8 })).toThrow("not a v10 benchmark report: schema_version is 8");
    const withoutCode = validReport() as unknown as { git: Record<string, unknown> };
    delete withoutCode.git["code_sha"];
    expect(() => readBenchmarkReport(withoutCode)).toThrow("report.git.code_sha is missing");
    const withoutLog = validReport() as unknown as Record<string, unknown>;
    delete withoutLog["runner_log"];
    expect(() => readBenchmarkReport(withoutLog)).toThrow("report.runner_log is missing");
    const withoutFiles = validReport();
    delete (withoutFiles.runner_log as unknown as Record<string, unknown>)["files"];
    expect(() => readBenchmarkReport(withoutFiles)).toThrow("runner_log.files is not an array");
    for (const key of ["truncated", "model_retry", "repo_instructions"]) {
      const report = validReport();
      delete (report.runner_log as unknown as Record<string, unknown>)[key];
      expect(() => readBenchmarkReport(report), key).toThrow(`report.runner_log.${key} is missing`);
    }
  });

  it("refuses a v9 report, and one whose arm names no background setting or another word", () => {
    expect(() => readBenchmarkReport({ ...validReport(), schema_version: 9 })).toThrow("not a v10 benchmark report: schema_version is 9");
    const unnamed = validReport();
    delete (unnamed.methodology as unknown as Record<string, unknown>)["shell_background"];
    expect(() => readBenchmarkReport(unnamed)).toThrow("report.methodology.shell_background is missing, expected one of on, off");
    const other = validReport();
    (other.methodology as unknown as Record<string, unknown>)["shell_background"] = "auto";
    expect(() => readBenchmarkReport(other)).toThrow('report.methodology.shell_background is "auto", expected one of on, off');
    const off = validReport();
    off.methodology.shell_background = "off";
    expect(readBenchmarkReport(off).methodology.shell_background).toBe("off");
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
