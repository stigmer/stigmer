/**
 * useExportCSV names each download after the organization it was given, in
 * both formats, from the report already in memory, and writes one CSV row
 * per day (date, runs, tokens, cost in USD) or per model.
 */
import { act, renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import { GetOrgUsageReportOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";

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

  it("writes one daily row per day with its runs, tokens and cost in USD", () => {
    downloads.length = 0;
    const report = create(GetOrgUsageReportOutputSchema, {
      dailyCosts: [
        { date: "2026-10-01", runCount: 12, totalTokens: 34_000n, billableCostMicros: 1_250_000n },
        { date: "2026-10-02", runCount: 0, totalTokens: 0n, billableCostMicros: 0n },
      ],
    });
    const { result } = renderHook(() => useExportCSV(report, "acme"));
    act(() => result.current.exportCSV("daily_summary"));

    expect(downloads[0]!.csv).toBe(
      ["Date,Runs,Tokens,Cost (USD)", "2026-10-01,12,34000,1.250000", "2026-10-02,0,0,0.000000"].join("\n"),
    );
  });
});
