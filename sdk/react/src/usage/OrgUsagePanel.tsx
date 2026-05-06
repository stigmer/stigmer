"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type {
  DailyCostEntry,
  GetOrgUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { formatCost, formatTokenCount } from "../execution/UsageWidget";
import { useOrgUsageReport } from "./useOrgUsageReport";
import {
  DATE_RANGE_PRESETS,
  dateRangeFromPreset,
  formatDateRange,
  presetLabel,
  type DateRangePreset,
} from "./date-range";
import { CreditRunwayIndicator } from "./CreditRunwayIndicator";
import { AgentBreakdownList } from "./AgentBreakdownList";
import { HarnessSplitCard } from "./HarnessSplitCard";
import { ExportButton } from "./ExportButton";
import { useExportCSV } from "./useExportCSV";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OrgUsagePanel}. */
export interface OrgUsagePanelProps {
  /** Organization ID (`metadata.id`) to fetch usage for. */
  readonly orgId: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained dashboard panel showing organization-wide LLM usage metrics.
 *
 * Displays summary cards (total cost, LLM calls, tokens), a daily cost
 * bar chart, and per-model breakdown with call counts and token splits.
 * Data is fetched via `getOrgUsageReport` with a configurable date range.
 *
 * All visual properties flow through `--stgm-*` design tokens. Zero
 * Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <OrgUsagePanel orgId={activeOrg.metadata.id} />
 * ```
 */
export function OrgUsagePanel({ orgId, className }: OrgUsagePanelProps) {
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const dateRange = dateRangeFromPreset(preset);
  const { report, isLoading, error } = useOrgUsageReport(orgId, dateRange);
  const { exportCSV, isExporting } = useExportCSV(report, orgId);
  const daysInRange = Number.parseInt(preset, 10);

  if (isLoading) {
    return (
      <div
        className={cn("space-y-4", className)}
        aria-busy="true"
        aria-label="Loading usage data"
      >
        <div className="flex gap-2">
          {DATE_RANGE_PRESETS.map((p) => (
            <div
              key={p}
              className="h-7 w-16 animate-pulse rounded-md bg-muted-subtle"
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="h-[72px] animate-pulse rounded-lg bg-muted-subtle"
            />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-lg bg-muted-subtle" />
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (!report) return null;

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between gap-3">
        <DateRangeSelector
          activePreset={preset}
          onPresetChange={setPreset}
          dateRange={dateRange}
        />
        <ExportButton
          onExport={exportCSV}
          isExporting={isExporting}
          disabled={!report || report.modelBreakdown.length === 0}
        />
      </div>

      <SummaryCards report={report} daysInRange={daysInRange} />

      {report.dailyCosts.length > 0 && (
        <DailyCostChart entries={report.dailyCosts} />
      )}

      {report.harnessBreakdown.length > 0 && (
        <HarnessSplitCard breakdown={report.harnessBreakdown} />
      )}

      {report.topAgentsByCost.length > 0 && (
        <AgentBreakdownList
          agents={report.topAgentsByCost}
          totalBillableCostMicros={report.totalBillableCostMicros}
        />
      )}

      {report.modelBreakdown.length > 0 && (
        <ModelBreakdownList models={report.modelBreakdown} />
      )}

      {report.modelBreakdown.length === 0 && <EmptyState />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateRangeSelector (internal)
// ---------------------------------------------------------------------------

function DateRangeSelector({
  activePreset,
  onPresetChange,
  dateRange,
}: {
  activePreset: DateRangePreset;
  onPresetChange: (preset: DateRangePreset) => void;
  dateRange: { from: string; to: string };
}) {
  return (
    <div
      className="flex items-center gap-3"
      role="group"
      aria-label="Date range"
    >
      <div className="flex gap-1.5">
        {DATE_RANGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPresetChange(p)}
            aria-pressed={p === activePreset}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              p === activePreset
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {presetLabel(p)}
          </button>
        ))}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatDateRange(dateRange)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SummaryCards (internal)
// ---------------------------------------------------------------------------

function microsToUsd(micros: bigint): number {
  return Number(micros) / 1_000_000;
}

function SummaryCards({
  report,
  daysInRange,
}: {
  report: GetOrgUsageReportOutput;
  daysInRange: number;
}) {
  const { totalLlmCalls, totalTokens } = report.modelBreakdown.reduce(
    (acc, m) => ({
      totalLlmCalls: acc.totalLlmCalls + m.callCount,
      totalTokens:
        acc.totalTokens +
        Number(m.inputTokens) +
        Number(m.outputTokens) +
        Number(m.cacheCreationInputTokens) +
        Number(m.cacheReadInputTokens),
    }),
    { totalLlmCalls: 0, totalTokens: 0 },
  );

  return (
    <div role="group" aria-label="Usage summary" className="space-y-2">
      {/* Primary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card px-3.5 py-3">
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {formatCost(microsToUsd(report.totalBillableCostMicros))}
          </div>
          <div className="text-xs text-muted-foreground">Total Cost</div>
          <CreditRunwayIndicator
            totalBillableCostMicros={report.totalBillableCostMicros}
            daysInRange={daysInRange}
            className="mt-0.5 block"
          />
        </div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-3">
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {formatCompactNumber(totalLlmCalls)}
          </div>
          <div className="text-xs text-muted-foreground">LLM Calls</div>
        </div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-3">
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {formatCompactNumber(totalTokens)}
          </div>
          <div className="text-xs text-muted-foreground">Tokens</div>
        </div>
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border-muted bg-card/50 px-3.5 py-2.5">
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {formatCompactNumber(report.totalExecutions)}
          </div>
          <div className="text-[0.65rem] text-muted-foreground">Executions</div>
        </div>
        <div className="rounded-lg border border-border-muted bg-card/50 px-3.5 py-2.5">
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {formatCompactNumber(report.totalAgents)}
          </div>
          <div className="text-[0.65rem] text-muted-foreground">Agents</div>
        </div>
        <div className="rounded-lg border border-border-muted bg-card/50 px-3.5 py-2.5">
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {formatCompactNumber(report.totalSessions)}
          </div>
          <div className="text-[0.65rem] text-muted-foreground">Sessions</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DailyCostChart (internal) — CSS-only bar chart
// ---------------------------------------------------------------------------

const CHART_HEIGHT_PX = 128;

function DailyCostChart({ entries }: { entries: readonly DailyCostEntry[] }) {
  const maxCost = Math.max(...entries.map((e) => microsToUsd(e.billableCostMicros)), 0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        Daily Cost
      </h3>
      <div className="rounded-lg border border-border bg-card px-3 pb-2 pt-3">
        {/* Tooltip */}
        <div className="mb-1 h-4">
          {hoveredIdx !== null && entries[hoveredIdx] && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatChartDate(entries[hoveredIdx].date)}
              {" \u00B7 "}
              {formatCost(microsToUsd(entries[hoveredIdx].billableCostMicros))}
              {" \u00B7 "}
              {formatTokenCount(Number(entries[hoveredIdx].totalTokens))} tokens
            </span>
          )}
        </div>

        {/* Bars */}
        <div
          className="flex items-end gap-px"
          style={{ height: CHART_HEIGHT_PX }}
          role="img"
          aria-label="Daily cost bar chart"
        >
          {entries.map((entry, i) => {
            const ratio =
              maxCost > 0 ? microsToUsd(entry.billableCostMicros) / maxCost : 0;
            const heightPx = Math.max(ratio * CHART_HEIGHT_PX, 2);

            return (
              <div
                key={entry.date}
                className="group relative flex-1"
                style={{ height: CHART_HEIGHT_PX }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <div
                  className={cn(
                    "absolute inset-x-0 bottom-0 rounded-t-sm transition-colors",
                    hoveredIdx === i
                      ? "bg-chart-1"
                      : "bg-chart-1/70",
                  )}
                  style={{ height: heightPx }}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis labels — show first, middle, and last */}
        {entries.length > 0 && (
          <div className="mt-1.5 flex justify-between">
            <span className="text-[0.6rem] tabular-nums text-muted-foreground">
              {formatChartDate(entries[0].date)}
            </span>
            {entries.length > 2 && (
              <span className="text-[0.6rem] tabular-nums text-muted-foreground">
                {formatChartDate(
                  entries[Math.floor(entries.length / 2)].date,
                )}
              </span>
            )}
            {entries.length > 1 && (
              <span className="text-[0.6rem] tabular-nums text-muted-foreground">
                {formatChartDate(entries[entries.length - 1].date)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelBreakdownList (internal)
// ---------------------------------------------------------------------------

function ModelBreakdownList({
  models,
}: {
  models: readonly ModelUsage[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        Model Breakdown
      </h3>
      <div
        className="rounded-lg border border-border bg-card"
        role="table"
        aria-label="Model usage breakdown"
      >
        <div
          role="row"
          className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-border px-3.5 py-2 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground"
        >
          <span role="columnheader">Model</span>
          <span role="columnheader" className="text-right">
            Calls
          </span>
          <span role="columnheader" className="text-right">
            Input
          </span>
          <span role="columnheader" className="text-right">
            Output
          </span>
          <span role="columnheader" className="text-right">
            Cost
          </span>
        </div>
        {models.map((m) => {
          const inputTok = Number(m.inputTokens);
          const cacheCreation = Number(m.cacheCreationInputTokens);
          const cacheRead = Number(m.cacheReadInputTokens);
          const totalInput = inputTok + cacheCreation + cacheRead;
          const hasCache = cacheRead > 0 || cacheCreation > 0;

          return (
            <div
              key={`${m.model}\0${m.provider}`}
              className="border-b border-border-muted px-3.5 py-2 last:border-b-0"
            >
              <div
                role="row"
                className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4"
              >
                <div role="cell" className="min-w-0">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {m.model}
                  </span>
                  <span className="text-[0.65rem] text-muted-foreground">
                    {m.provider}
                  </span>
                </div>
                <span
                  role="cell"
                  className="self-center text-right text-xs tabular-nums text-muted-foreground"
                >
                  {formatCompactNumber(m.callCount)}
                </span>
                <span
                  role="cell"
                  className="self-center text-right text-xs tabular-nums text-muted-foreground"
                >
                  {formatCompactNumber(totalInput)}
                </span>
                <span
                  role="cell"
                  className="self-center text-right text-xs tabular-nums text-muted-foreground"
                >
                  {formatCompactNumber(Number(m.outputTokens))}
                </span>
                <span
                  role="cell"
                  className="self-center text-right text-xs tabular-nums text-foreground"
                >
                  {formatCost(microsToUsd(m.billableCostMicros))}
                </span>
              </div>
              {hasCache && (
                <div className="mt-0.5 text-[0.6rem] tabular-nums text-muted-foreground">
                  cache{" "}
                  {cacheRead > 0 &&
                    `${formatCompactNumber(cacheRead)} read`}
                  {cacheRead > 0 && cacheCreation > 0 &&
                    " · "}
                  {cacheCreation > 0 &&
                    `${formatCompactNumber(cacheCreation)} write`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState (internal)
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <ChartIcon className="text-muted-foreground mb-3 size-8" />
      <p className="text-sm font-medium text-foreground">No usage data yet</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Usage data will appear here once agents start running executions
        in this organization.
      </p>
    </div>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M7 16l4-8 4 4 4-6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a number with compact suffixes for dashboard cards.
 * Examples: 847 -> "847", 2_340 -> "2.3K", 1_200_000 -> "1.2M"
 */
function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return v >= 100 ? `${Math.round(v)}M` : `${trimTrailingZero(v.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return v >= 100 ? `${Math.round(v)}K` : `${trimTrailingZero(v.toFixed(1))}K`;
  }
  return String(n);
}

function trimTrailingZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * Format a YYYY-MM-DD date for chart axis labels (e.g. "Apr 02").
 */
function formatChartDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(date);
}
