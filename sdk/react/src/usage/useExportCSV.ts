"use client";

/**
 * CSV export of the organization usage report already in memory: one row
 * per day or one row per model, in tokens and calls, never money.
 *
 * Built client-side from the loaded report, so an export always matches
 * what the panel shows and costs no extra request. The suite in
 * `__tests__/useExportCSV.test.tsx` pins the filenames and both formats'
 * columns.
 */

import { useCallback, useState } from "react";
import type { GetOrgUsageReportOutput } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { downloadTextFile } from "../internal/download.js";

/** Export format for the CSV download. */
export type ExportFormat = "daily_summary" | "model_breakdown";

/** Return value of {@link useExportCSV}. */
export interface UseExportCSVReturn {
  /** Trigger a CSV download for the given format. */
  readonly exportCSV: (format: ExportFormat) => void;
  /** Whether an export is being generated. */
  readonly isExporting: boolean;
}

/**
 * Behavior hook that generates and downloads usage data as CSV.
 *
 * Operates entirely client-side from data already in memory — no
 * additional RPC calls. Supports two formats:
 * - `daily_summary` — one row per UTC day with date, runs, tokens, LLM calls
 * - `model_breakdown` — one row per model with calls and each token bucket
 *
 * @param report - The org usage report data (from `useOrgUsageReport`).
 * @param org - Organization ID for the filename.
 */
export function useExportCSV(
  report: GetOrgUsageReportOutput | null,
  org: string,
): UseExportCSVReturn {
  const [isExporting, setIsExporting] = useState(false);

  const exportCSV = useCallback(
    (format: ExportFormat) => {
      if (!report) return;
      setIsExporting(true);

      try {
        const { csv, filename } = format === "daily_summary"
          ? buildDailySummaryCSV(report, org)
          : buildModelBreakdownCSV(report, org);

        downloadTextFile(csv, filename, "text/csv");
      } finally {
        setIsExporting(false);
      }
    },
    [report, org],
  );

  return { exportCSV, isExporting };
}

function buildDailySummaryCSV(
  report: GetOrgUsageReportOutput,
  org: string,
): { csv: string; filename: string } {
  const header = "Date,Runs,Tokens,LLM Calls";
  const rows = report.dailyUsage.map(
    (entry) => `${entry.date},${entry.runCount},${entry.totalTokens},${entry.llmCallCount}`,
  );

  return {
    csv: [header, ...rows].join("\n"),
    filename: `${org}-daily-usage.csv`,
  };
}

function buildModelBreakdownCSV(
  report: GetOrgUsageReportOutput,
  org: string,
): { csv: string; filename: string } {
  const header =
    "Model,Provider,Calls,Input Tokens,Output Tokens,Cache Read Tokens,Cache Write Tokens,Total Tokens";
  const rows = report.modelBreakdown.map((m) =>
    [
      escapeCsvField(m.model),
      escapeCsvField(m.provider),
      m.callCount,
      m.inputTokens,
      m.outputTokens,
      m.cacheReadInputTokens,
      m.cacheCreationInputTokens,
      m.totalTokens,
    ].join(","),
  );

  return {
    csv: [header, ...rows].join("\n"),
    filename: `${org}-model-usage.csv`,
  };
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
