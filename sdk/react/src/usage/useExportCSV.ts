"use client";

import { useCallback, useState } from "react";
import type { GetOrgUsageReportOutput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
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
 * - `daily_summary` — one row per day with date, executions, tokens, cost
 * - `model_breakdown` — one row per model with calls, tokens, cost
 *
 * @param report - The org usage report data (from `useOrgUsageReport`).
 * @param orgId - Organization ID for the filename.
 */
export function useExportCSV(
  report: GetOrgUsageReportOutput | null,
  orgId: string,
): UseExportCSVReturn {
  const [isExporting, setIsExporting] = useState(false);

  const exportCSV = useCallback(
    (format: ExportFormat) => {
      if (!report) return;
      setIsExporting(true);

      try {
        const { csv, filename } = format === "daily_summary"
          ? buildDailySummaryCSV(report, orgId)
          : buildModelBreakdownCSV(report, orgId);

        downloadTextFile(csv, filename, "text/csv");
      } finally {
        setIsExporting(false);
      }
    },
    [report, orgId],
  );

  return { exportCSV, isExporting };
}

function buildDailySummaryCSV(
  report: GetOrgUsageReportOutput,
  orgId: string,
): { csv: string; filename: string } {
  const header = "Date,Executions,Tokens,Cost (USD)";
  const rows = report.dailyCosts.map((entry) => {
    const cost = (Number(entry.billableCostMicros) / 1_000_000).toFixed(6);
    return `${entry.date},${entry.executionCount},${entry.totalTokens},${cost}`;
  });

  return {
    csv: [header, ...rows].join("\n"),
    filename: `${orgId}-daily-usage.csv`,
  };
}

function buildModelBreakdownCSV(
  report: GetOrgUsageReportOutput,
  orgId: string,
): { csv: string; filename: string } {
  const header =
    "Model,Provider,Calls,Input Tokens,Output Tokens,Cache Read Tokens,Cache Write Tokens,Cost (USD)";
  const rows = report.modelBreakdown.map((m) => {
    const cost = (Number(m.billableCostMicros) / 1_000_000).toFixed(6);
    return [
      escapeCsvField(m.model),
      escapeCsvField(m.provider),
      m.callCount,
      m.inputTokens,
      m.outputTokens,
      m.cacheReadInputTokens,
      m.cacheCreationInputTokens,
      cost,
    ].join(",");
  });

  return {
    csv: [header, ...rows].join("\n"),
    filename: `${orgId}-model-usage.csv`,
  };
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
