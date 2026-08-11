"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type {
  DailyCostEntry,
  GetOrgUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { formatCost, formatTokenCount } from "../execution/UsageWidget.js";
import { useOrgUsageReport } from "./useOrgUsageReport.js";
import {
  DATE_RANGE_PRESETS,
  dateRangeFromPreset,
  formatDateRange,
  presetLabel,
  type DateRangePreset,
} from "./date-range.js";
import { CreditRunwayIndicator } from "./CreditRunwayIndicator.js";
import { AgentBreakdownList } from "./AgentBreakdownList.js";
import { HarnessSplitCard } from "./HarnessSplitCard.js";
import { ExportButton } from "./ExportButton.js";
import { useExportCSV } from "./useExportCSV.js";

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
        className={cn("stg:space-y-4", className)}
        aria-busy="true"
        aria-label="Loading usage data"
      >
        <div className="stg:flex stg:gap-2">
          {DATE_RANGE_PRESETS.map((p) => (
            <div
              key={p}
              className="stg:h-7 stg:w-16 stg:animate-pulse stg:rounded-md stg:bg-muted-subtle"
            />
          ))}
        </div>
        <div className="stg:grid stg:grid-cols-3 stg:gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="stg:h-[72px] stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle"
            />
          ))}
        </div>
        <div className="stg:h-40 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (!report) return null;

  return (
    <div className={cn("stg:space-y-6", className)}>
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
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
      className="stg:flex stg:items-center stg:gap-3"
      role="group"
      aria-label="Date range"
    >
      <div className="stg:flex stg:gap-1.5">
        {DATE_RANGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPresetChange(p)}
            aria-pressed={p === activePreset}
            className={cn(
              "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
              p === activePreset
                ? "stg:bg-primary stg:text-primary-foreground"
                : "stg:bg-muted stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent",
            )}
          >
            {presetLabel(p)}
          </button>
        ))}
      </div>
      <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
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
    <div role="group" aria-label="Usage summary" className="stg:space-y-2">
      {/* Primary row */}
      <div className="stg:grid stg:grid-cols-3 stg:gap-3">
        <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3.5 stg:py-3">
          <div className="stg:text-lg stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCost(microsToUsd(report.totalBillableCostMicros))}
          </div>
          <div className="stg:text-xs stg:text-muted-foreground">Total Cost</div>
          <CreditRunwayIndicator
            totalBillableCostMicros={report.totalBillableCostMicros}
            daysInRange={daysInRange}
            className="stg:mt-0.5 stg:block"
          />
        </div>
        <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3.5 stg:py-3">
          <div className="stg:text-lg stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactNumber(totalLlmCalls)}
          </div>
          <div className="stg:text-xs stg:text-muted-foreground">LLM Calls</div>
        </div>
        <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3.5 stg:py-3">
          <div className="stg:text-lg stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactNumber(totalTokens)}
          </div>
          <div className="stg:text-xs stg:text-muted-foreground">Tokens</div>
        </div>
      </div>

      {/* Secondary row */}
      <div className="stg:grid stg:grid-cols-3 stg:gap-3">
        <div className="stg:rounded-lg stg:border stg:border-border-muted stg:bg-muted-subtle stg:px-3.5 stg:py-2.5">
          <div className="stg:text-sm stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactNumber(report.totalExecutions)}
          </div>
          <div className="stg:text-[0.65rem] stg:text-muted-foreground">Executions</div>
        </div>
        <div className="stg:rounded-lg stg:border stg:border-border-muted stg:bg-muted-subtle stg:px-3.5 stg:py-2.5">
          <div className="stg:text-sm stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactNumber(report.totalAgents)}
          </div>
          <div className="stg:text-[0.65rem] stg:text-muted-foreground">Agents</div>
        </div>
        <div className="stg:rounded-lg stg:border stg:border-border-muted stg:bg-muted-subtle stg:px-3.5 stg:py-2.5">
          <div className="stg:text-sm stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactNumber(report.totalSessions)}
          </div>
          <div className="stg:text-[0.65rem] stg:text-muted-foreground">Sessions</div>
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
      <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
        Daily Cost
      </h3>
      <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3 stg:pb-2 stg:pt-3">
        {/* Tooltip */}
        <div className="stg:mb-1 stg:h-4">
          {hoveredIdx !== null && entries[hoveredIdx] && (
            <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
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
          className="stg:flex stg:items-end stg:gap-px"
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
                className="stg:group stg:relative stg:flex-1"
                style={{ height: CHART_HEIGHT_PX }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <div
                  className={cn(
                    "stg:absolute stg:inset-x-0 stg:bottom-0 stg:rounded-t-sm stg:transition-colors",
                    hoveredIdx === i
                      ? "stg:bg-chart-1"
                      : "stg:bg-chart-1/70",
                  )}
                  style={{ height: heightPx }}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis labels — show first, middle, and last */}
        {entries.length > 0 && (
          <div className="stg:mt-1.5 stg:flex stg:justify-between">
            <span className="stg:text-[0.6rem] stg:tabular-nums stg:text-muted-foreground">
              {formatChartDate(entries[0].date)}
            </span>
            {entries.length > 2 && (
              <span className="stg:text-[0.6rem] stg:tabular-nums stg:text-muted-foreground">
                {formatChartDate(
                  entries[Math.floor(entries.length / 2)].date,
                )}
              </span>
            )}
            {entries.length > 1 && (
              <span className="stg:text-[0.6rem] stg:tabular-nums stg:text-muted-foreground">
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
      <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
        Model Breakdown
      </h3>
      <div
        className="stg:rounded-lg stg:border stg:border-border stg:bg-card"
        role="table"
        aria-label="Model usage breakdown"
      >
        <div
          role="row"
          className="stg:grid stg:grid-cols-[1fr_auto_auto_auto_auto] stg:gap-x-4 stg:border-b stg:border-border stg:px-3.5 stg:py-2 stg:text-[0.65rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground"
        >
          <span role="columnheader">Model</span>
          <span role="columnheader" className="stg:text-right">
            Calls
          </span>
          <span role="columnheader" className="stg:text-right">
            Input
          </span>
          <span role="columnheader" className="stg:text-right">
            Output
          </span>
          <span role="columnheader" className="stg:text-right">
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
              className="stg:border-b stg:border-border-muted stg:px-3.5 stg:py-2 stg:last:border-b-0"
            >
              <div
                role="row"
                className="stg:grid stg:grid-cols-[1fr_auto_auto_auto_auto] stg:gap-x-4"
              >
                <div role="cell" className="stg:min-w-0">
                  <span className="stg:block stg:truncate stg:text-xs stg:font-medium stg:text-foreground">
                    {m.model}
                  </span>
                  <span className="stg:text-[0.65rem] stg:text-muted-foreground">
                    {m.provider}
                  </span>
                </div>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-muted-foreground"
                >
                  {formatCompactNumber(m.callCount)}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-muted-foreground"
                >
                  {formatCompactNumber(totalInput)}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-muted-foreground"
                >
                  {formatCompactNumber(Number(m.outputTokens))}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-foreground"
                >
                  {formatCost(microsToUsd(m.billableCostMicros))}
                </span>
              </div>
              {hasCache && (
                <div className="stg:mt-0.5 stg:text-[0.6rem] stg:tabular-nums stg:text-muted-foreground">
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
    <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:py-12 stg:text-center">
      <ChartIcon className="stg:text-muted-foreground stg:mb-3 stg:size-8" />
      <p className="stg:text-sm stg:font-medium stg:text-foreground">No usage data yet</p>
      <p className="stg:mt-1 stg:max-w-xs stg:text-xs stg:text-muted-foreground">
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
