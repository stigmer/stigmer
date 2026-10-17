/**
 * useExportCSV names each download after the organization it was given, in
 * both formats, from the report already in memory, and writes one CSV row
 * per day (date, runs, tokens, LLM calls) or per model (calls and each token
 * bucket with the total), with no money column.
 */
import { act, renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import { GetOrgUsageReportOutputSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";

const downloads = vi.hoisted(() => [] as Array<{ filename: string; csv: string }>);

vi.mock("../../internal/download.js", () => ({
  downloadTextFile: (csv: string, filename: string) => {
    downloads.push({ csv, filename });
  },
}));

import { useExportCSV } from "../useExportCSV";

describe("useExportCSV", () => {
  it("names the daily summary and the model breakdown after the organization", () => {
    const report = create(GetOrgUsageReportOutputSchema, {});
    const { result } = renderHook(() => useExportCSV(report, "acme"));
    act(() => result.current.exportCSV("daily_summary"));
    act(() => result.current.exportCSV("model_breakdown"));
    expect(downloads.map((d) => d.filename)).toEqual(["acme-daily-usage.csv", "acme-model-usage.csv"]);
  });

  it("writes one daily row per day with its runs, tokens and LLM calls", () => {
    downloads.length = 0;
    const report = create(GetOrgUsageReportOutputSchema, {
      dailyUsage: [
        { date: "2026-10-01", runCount: 12, totalTokens: 34_000n, llmCallCount: 40 },
        { date: "2026-10-02", runCount: 1, totalTokens: 900n, llmCallCount: 0 },
      ],
    });
    const { result } = renderHook(() => useExportCSV(report, "acme"));
    act(() => result.current.exportCSV("daily_summary"));

    expect(downloads[0]!.csv).toBe(
      ["Date,Runs,Tokens,LLM Calls", "2026-10-01,12,34000,40", "2026-10-02,1,900,0"].join("\n"),
    );
  });

  it("writes one model row with its calls, each token bucket and the total", () => {
    downloads.length = 0;
    const report = create(GetOrgUsageReportOutputSchema, {
      modelBreakdown: [
        {
          model: "claude-sonnet-4-6",
          provider: "anthropic",
          callCount: 3,
          inputTokens: 100n,
          outputTokens: 50n,
          cacheReadInputTokens: 800n,
          cacheCreationInputTokens: 50n,
          totalTokens: 1_000n,
        },
      ],
    });
    const { result } = renderHook(() => useExportCSV(report, "acme"));
    act(() => result.current.exportCSV("model_breakdown"));

    expect(downloads[0]!.csv).toBe(
      [
        "Model,Provider,Calls,Input Tokens,Output Tokens,Cache Read Tokens,Cache Write Tokens,Total Tokens",
        "claude-sonnet-4-6,anthropic,3,100,50,800,50,1000",
      ].join("\n"),
    );
  });
});
