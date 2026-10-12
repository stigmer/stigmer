/**
 * Pins the Quality tab's pure reads: a rate never without its count and
 * none when nothing counted; each metric read at its first-listed (current)
 * evaluator version; daily series that leave a gap on a day graded only
 * under other rules and skip a day with no grade; the days the agent's
 * version changed, the window's first version excluded; a flagged grade in
 * words that never carries a reason or a comment; and the latest finished
 * agent eval per version with its case pass rate.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentQualityReportSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { agentEvalWith } from "../../agent-eval/__tests__/agent-eval-fixture";
import {
  criterionNamesOf,
  criterionRateOf,
  currentEvaluatorVersionOf,
  dailyRateSeries,
  dailyRunsSeries,
  evalPassRateOf,
  evaluatorChangedIn,
  flaggedWhatOf,
  formatPassRate,
  latestFinishedEvalByVersion,
  metricLabelOf,
  metricRateOf,
  passRateOf,
  versionChangesOf,
} from "../quality-view";
import { VERSION_HASH, flaggedScore, qualityReport } from "./quality-fixture";

describe("pass rates", () => {
  it("is passed over passed plus failed, with that count, and none when nothing counted", () => {
    expect(passRateOf(3, 1)).toEqual({ rate: 0.75, count: 4 });
    expect(passRateOf(0, 0)).toBeNull();
    expect(formatPassRate({ rate: 0.8333, count: 12 })).toBe("83% of 12");
    expect(formatPassRate(null)).toBe("—");
  });

  it("reads a metric and a rubric at one evaluator version, never two added together", () => {
    const total = qualityReport().total;
    expect(currentEvaluatorVersionOf(total, "judge")).toBe("judge-v2");
    expect(currentEvaluatorVersionOf(total, "run-health")).toBe("health-v1");
    expect(currentEvaluatorVersionOf(total, "nothing")).toBeNull();
    expect(metricRateOf(total, "judge", "judge-v2")).toEqual({ rate: 0.5, count: 6 });
    expect(criterionRateOf(total, "judge", "judge-v2", "task")).toEqual({ rate: 0.5, count: 6 });
    // Not applicable is left out of both sides.
    expect(criterionRateOf(total, "judge", "judge-v2", "honest")).toEqual({ rate: 1, count: 5 });
    expect(criterionNamesOf(total, "judge", "judge-v2")).toEqual(["task", "honest"]);
    expect(evaluatorChangedIn(total, "judge")).toBe(true);
    expect(evaluatorChangedIn(total, "run-health")).toBe(false);
  });
});

describe("daily series", () => {
  it("leaves a gap where only other rules graded, and points elsewhere", () => {
    const report = qualityReport();
    expect(dailyRateSeries(report, "judge", "judge-v2", "task")).toEqual([
      { date: "2026-10-01", value: null, count: 0 },
      { date: "2026-10-05", value: 2 / 3, count: 3 },
      { date: "2026-10-10", value: 1 / 3, count: 3 },
    ]);
    expect(dailyRateSeries(report, "run-health", "health-v1")).toEqual([
      { date: "2026-10-01", value: 5 / 6, count: 6 },
      { date: "2026-10-05", value: 1, count: 3 },
      { date: "2026-10-10", value: 2 / 3, count: 3 },
    ]);
  });

  it("skips a day with no grade of the metric, so the line joins across it", () => {
    const series = dailyRateSeries(qualityReport(), "feedback", "");
    expect(series.map((point) => point.date)).toEqual(["2026-10-05", "2026-10-10"]);
  });

  it("skips a day whose grades at the current version give no rate", () => {
    const report = create(AgentQualityReportSchema, {
      days: [
        {
          date: "2026-10-02",
          summary: {
            runs: 1,
            metrics: [{ metric: "run-health", evaluatorVersion: "h", passed: 0, failed: 0, notGraded: 1 }],
          },
        },
      ],
    });
    expect(dailyRateSeries(report, "run-health", "h")).toEqual([]);
  });

  it("counts the runs graded each day", () => {
    expect(dailyRunsSeries(qualityReport()).map((point) => point.value)).toEqual([6, 3, 3]);
  });
});

describe("version changes", () => {
  it("is each version's first day but the window's first version", () => {
    expect(versionChangesOf(qualityReport())).toEqual([
      { date: "2026-10-05", agentVersionHash: VERSION_HASH },
    ]);
  });

  it("names a day two versions were first seen by the most recently seen one", () => {
    const report = create(AgentQualityReportSchema, {
      versions: [
        { agentVersionHash: "newest", firstDate: "2026-10-04", lastDate: "2026-10-09" },
        { agentVersionHash: "middle", firstDate: "2026-10-04", lastDate: "2026-10-04" },
        { agentVersionHash: "oldest", firstDate: "2026-10-01", lastDate: "2026-10-03" },
      ],
    });
    expect(versionChangesOf(report)).toEqual([
      { date: "2026-10-04", agentVersionHash: "newest" },
    ]);
  });
});

describe("flagged grades in words", () => {
  it("names the failed checks or rubrics, or thumbs down, never a reason or a comment", () => {
    expect(flaggedWhatOf(flaggedScore("s1", "run-health", "run_1", ["loop", "tool-errors"]))).toBe(
      "loop, tool-errors",
    );
    expect(flaggedWhatOf(flaggedScore("s2", "judge", "run_2"))).toBe("AI judge");
    const thumbs = flaggedWhatOf(flaggedScore("s3", "feedback", "run_3", ["private"]));
    expect(thumbs).toBe("thumbs down");
    expect(thumbs).not.toContain("private");
  });
});

describe("evals by version", () => {
  it("keeps each version's newest finished eval, partial included, running and failed left out", () => {
    const running = agentEvalWith([], { id: "aev_run", version: "v1", phase: PluginEvalPhase.running });
    const partial = agentEvalWith(
      [{ slug: "p", cases: [{ name: "a", score: 1 }, { name: "b", score: 0 }] }],
      { id: "aev_partial", version: "v1", phase: PluginEvalPhase.partial },
    );
    const older = agentEvalWith([], { id: "aev_old", version: "v1" });
    const failed = agentEvalWith([], { id: "aev_failed", version: "v2", phase: PluginEvalPhase.failed });
    const latest = latestFinishedEvalByVersion([running, partial, older, failed]);
    expect(latest.get("v1")?.metadata?.id).toBe("aev_partial");
    expect(latest.has("v2")).toBe(false);
    expect(evalPassRateOf(partial)).toEqual({ rate: 0.5, count: 2 });
    expect(evalPassRateOf(older)).toBeNull();
  });
});

describe("metric labels", () => {
  it("names the platform's metrics in words and any other by its own name", () => {
    expect(metricLabelOf("run-health")).toBe("Run health");
    expect(metricLabelOf("judge")).toBe("AI judge");
    expect(metricLabelOf("feedback")).toBe("Thumbs");
    expect(metricLabelOf("a-later-rubric")).toBe("a-later-rubric");
  });
});
