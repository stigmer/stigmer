"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type {
  AgentUsageSummary,
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
 * Self-contained dashboard panel showing organization-wide usage metrics.
 *
 * Displays summary cards (total cost, executions, tokens, active agents),
 * a daily cost bar chart, per-model breakdown, and top agents by cost.
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
              className="h-7 w-16 animate-pulse rounded-md bg-muted/40"
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="h-[72px] animate-pulse rounded-lg bg-muted/40"
            />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-lg bg-muted/40" />
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
      <DateRangeSelector
        activePreset={preset}
        onPresetChange={setPreset}
        dateRange={dateRange}
      />

      <SummaryCards report={report} />

      {report.dailyCosts.length > 0 && (
        <DailyCostChart entries={report.dailyCosts} />
      )}

      {report.modelBreakdown.length > 0 && (
        <ModelBreakdownList models={report.modelBreakdown} />
      )}

      {report.topAgentsByCost.length > 0 && (
        <TopAgentsList agents={report.topAgentsByCost} />
      )}

      {report.totalExecutions === 0 && <EmptyState />}
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
      className="flex items-center justify-between gap-3"
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

function SummaryCards({ report }: { report: GetOrgUsageReportOutput }) {
  const totalTokens = report.modelBreakdown.reduce(
    (sum, m) =>
      sum +
      m.inputTokens +
      m.outputTokens +
      m.cacheCreationTokens +
      m.cacheReadTokens,
    0,
  );

  const cards: { label: string; value: string }[] = [
    { label: "Total Cost", value: formatCost(report.totalCostUsd) },
    {
      label: "Executions",
      value: formatCompactNumber(report.totalExecutions),
    },
    { label: "Tokens", value: formatCompactNumber(totalTokens) },
    { label: "Agents", value: formatCompactNumber(report.totalAgents) },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      role="group"
      aria-label="Usage summary"
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-border bg-card px-3.5 py-3"
        >
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {card.value}
          </div>
          <div className="text-xs text-muted-foreground">{card.label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DailyCostChart (internal) — CSS-only bar chart
// ---------------------------------------------------------------------------

const CHART_HEIGHT_PX = 128;

function DailyCostChart({ entries }: { entries: readonly DailyCostEntry[] }) {
  const maxCost = Math.max(...entries.map((e) => e.estimatedCostUsd), 0);
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
              {formatCost(entries[hoveredIdx].estimatedCostUsd)}
              {" \u00B7 "}
              {formatTokenCount(entries[hoveredIdx].totalTokens)} tokens
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
              maxCost > 0 ? entry.estimatedCostUsd / maxCost : 0;
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
          className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-border px-3.5 py-2 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground"
        >
          <span role="columnheader">Model</span>
          <span role="columnheader" className="text-right">
            Tokens
          </span>
          <span role="columnheader" className="text-right">
            Cost
          </span>
        </div>
        {models.map((m) => {
          const totalTokens =
            m.inputTokens +
            m.outputTokens +
            m.cacheCreationTokens +
            m.cacheReadTokens;
          return (
            <div
              key={`${m.model}\0${m.provider}`}
              role="row"
              className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-border/50 px-3.5 py-2 last:border-b-0"
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
                {formatCompactNumber(totalTokens)}
              </span>
              <span
                role="cell"
                className="self-center text-right text-xs tabular-nums text-foreground"
              >
                {formatCost(m.estimatedCostUsd)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopAgentsList (internal)
// ---------------------------------------------------------------------------

function TopAgentsList({
  agents,
}: {
  agents: readonly AgentUsageSummary[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        Top Agents by Cost
      </h3>
      <div
        className="rounded-lg border border-border bg-card"
        role="table"
        aria-label="Top agents by cost"
      >
        <div
          role="row"
          className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-border px-3.5 py-2 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground"
        >
          <span role="columnheader">Agent</span>
          <span role="columnheader" className="text-right">
            Runs
          </span>
          <span role="columnheader" className="text-right">
            Tokens
          </span>
          <span role="columnheader" className="text-right">
            Cost
          </span>
        </div>
        {agents.map((a) => (
          <div
            key={a.agentId}
            role="row"
            className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-border/50 px-3.5 py-2 last:border-b-0"
          >
            <span
              role="cell"
              className="truncate text-xs font-medium text-foreground"
            >
              {a.agentName || a.agentId}
            </span>
            <span
              role="cell"
              className="text-right text-xs tabular-nums text-muted-foreground"
            >
              {formatCompactNumber(a.executionCount)}
            </span>
            <span
              role="cell"
              className="text-right text-xs tabular-nums text-muted-foreground"
            >
              {formatCompactNumber(a.totalTokens)}
            </span>
            <span
              role="cell"
              className="text-right text-xs tabular-nums text-foreground"
            >
              {formatCost(a.estimatedCostUsd)}
            </span>
          </div>
        ))}
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
