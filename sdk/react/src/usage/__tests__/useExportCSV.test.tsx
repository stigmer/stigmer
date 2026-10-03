/**
 * useExportCSV names each download after the organization it was given, in
 * both formats, from the report already in memory.
 */
import { act, renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import { GetOrgUsageReportOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

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
});
