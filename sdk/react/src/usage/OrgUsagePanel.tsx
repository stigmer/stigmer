"use client";

/**
 * Organization Usage panel: the organization's tokens, runs and calls over
 * a date range, a daily token chart, the harness split, the agents with the
 * most tokens, per-model rows and who served the tokens.
 *
 * Everything comes from one `getOrgUsageReport` read; the panel never sums
 * or prices anything itself, because the server already counts each run
 * once (from the deployment's meter, or from the run's own runner report).
 * Usage is tokens and calls, never money (stigmer-cloud#917). The suite in
 * `__tests__/OrgUsagePanel.test.tsx` pins the summary counts, the daily
 * chart's token tooltip, the model rows, the served-by line, the empty
 * state and the error.
 */

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import type {
  DailyUsage,
  GetOrgUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { useOrgUsageReport } from "./useOrgUsageReport.js";
import {
  DATE_RANGE_PRESETS,
  dateRangeFromPreset,
  formatDateRange,
  presetLabel,
  type DateRangePreset,
} from "./date-range.js";
import { AgentBreakdownList } from "./AgentBreakdownList.js";
import { HarnessSplitCard } from "./HarnessSplitCard.js";
import { ExportButton } from "./ExportButton.js";
import { useExportCSV } from "./useExportCSV.js";
import { ServedByLine } from "./ServedByLine.js";
import { formatCompactCount, formatTokens } from "./format.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OrgUsagePanel}. */
export interface OrgUsagePanelProps {
  /** Organization ID (`metadata.id`) to fetch usage for. */
  readonly org: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained dashboard panel showing organization-wide LLM usage.
 *
 * Displays summary cards (tokens, runs, LLM calls, agents, sessions), who
 * served the tokens, a daily token bar chart, the harness split, the
 * agents with the most tokens, and a per-model breakdown with call counts
 * and token splits. Data is fetched via `getOrgUsageReport` with a
 * configurable date range; usage is shown in tokens, never as money.
 *
 * All visual properties flow through `--stgm-*` design tokens. Zero
 * Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <OrgUsagePanel org={activeOrg.metadata.id} />
 * ```
 */
export function OrgUsagePanel({ org, className }: OrgUsagePanelProps) {
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const dateRange = dateRangeFromPreset(preset);
  const { report, isLoading, error } = useOrgUsageReport(org, dateRange);
  const { exportCSV, isExporting } = useExportCSV(report, org);

  if (isLoading) {
    return (
      <LoadingRegion
        className={cn("stg:space-y-4", className)}
        label="Loading usage data"
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
      </LoadingRegion>
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

      <div className="stg:space-y-2">
        <SummaryCards report={report} />
        <ServedByLine rows={report.totalUsage?.servedBy ?? []} showEstimated />
      </div>

      {report.dailyUsage.length > 0 && (
        <DailyTokenChart entries={report.dailyUsage} />
      )}

      {report.harnessUsage.length > 0 && (
        <HarnessSplitCard breakdown={report.harnessUsage} />
      )}

      {report.topAgents.length > 0 && (
        <AgentBreakdownList
          agents={report.topAgents}
          totalTokens={report.totalUsage?.totalTokens ?? BigInt(0)}
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

function SummaryCards({ report }: { report: GetOrgUsageReportOutput }) {
  const totalTokens = report.totalUsage?.totalTokens ?? BigInt(0);
  const llmCalls = report.totalUsage?.llmCallCount ?? 0;

  return (
    <div role="group" aria-label="Usage summary" className="stg:space-y-2">
      {/* Primary row */}
      <div className="stg:grid stg:grid-cols-3 stg:gap-3">
        <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3.5 stg:py-3">
          <div className="stg:text-lg stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactCount(totalTokens)}
          </div>
          <div className="stg:text-xs stg:text-muted-foreground">Tokens</div>
        </div>
        <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3.5 stg:py-3">
          <div className="stg:text-lg stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactCount(report.totalRuns)}
          </div>
          <div className="stg:text-xs stg:text-muted-foreground">Runs</div>
        </div>
        <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3.5 stg:py-3">
          <div className="stg:text-lg stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactCount(llmCalls)}
          </div>
          <div className="stg:text-xs stg:text-muted-foreground">LLM Calls</div>
        </div>
      </div>

      {/* Secondary row */}
      <div className="stg:grid stg:grid-cols-2 stg:gap-3">
        <div className="stg:rounded-lg stg:border stg:border-border-muted stg:bg-muted-subtle stg:px-3.5 stg:py-2.5">
          <div className="stg:text-sm stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactCount(report.totalAgents)}
          </div>
          <div className="stg:text-[0.65rem] stg:text-muted-foreground">Agents</div>
        </div>
        <div className="stg:rounded-lg stg:border stg:border-border-muted stg:bg-muted-subtle stg:px-3.5 stg:py-2.5">
          <div className="stg:text-sm stg:font-semibold stg:tabular-nums stg:text-foreground">
            {formatCompactCount(report.totalSessions)}
          </div>
          <div className="stg:text-[0.65rem] stg:text-muted-foreground">Sessions</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DailyTokenChart (internal) — CSS-only bar chart
// ---------------------------------------------------------------------------

const CHART_HEIGHT_PX = 128;

function DailyTokenChart({ entries }: { entries: readonly DailyUsage[] }) {
  const maxTokens = Math.max(...entries.map((e) => Number(e.totalTokens)), 0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const hovered = hoveredIdx !== null ? entries[hoveredIdx] : undefined;

  return (
    <div>
      <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
        Daily Tokens
      </h3>
      <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3 stg:pb-2 stg:pt-3">
        {/* Tooltip */}
        <div className="stg:mb-1 stg:h-4">
          {hovered && (
            <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
              {formatChartDate(hovered.date)}
              {" \u00B7 "}
              {formatTokens(hovered.totalTokens)}
              {" \u00B7 "}
              {formatCompactCount(hovered.runCount)} {hovered.runCount === 1 ? "run" : "runs"}
            </span>
          )}
        </div>

        {/* Bars */}
        <div
          className="stg:flex stg:items-end stg:gap-px"
          style={{ height: CHART_HEIGHT_PX }}
          role="img"
          aria-label="Daily token bar chart"
        >
          {entries.map((entry, i) => {
            const ratio =
              maxTokens > 0 ? Number(entry.totalTokens) / maxTokens : 0;
            const heightPx = Math.max(ratio * CHART_HEIGHT_PX, 2);

            return (
              <div
                key={entry.date}
                className="stg:group stg:relative stg:flex-1"
                style={{ height: CHART_HEIGHT_PX }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                data-testid="daily-token-bar"
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
            Total
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
                  {formatCompactCount(m.callCount)}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-muted-foreground"
                >
                  {formatCompactCount(totalInput)}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-muted-foreground"
                >
                  {formatCompactCount(Number(m.outputTokens))}
                </span>
                <span
                  role="cell"
                  className="stg:self-center stg:text-right stg:text-xs stg:tabular-nums stg:text-foreground"
                >
                  {formatCompactCount(m.totalTokens)}
                </span>
              </div>
              {hasCache && (
                <div className="stg:mt-0.5 stg:text-[0.6rem] stg:tabular-nums stg:text-muted-foreground">
                  cache{" "}
                  {cacheRead > 0 &&
                    `${formatCompactCount(cacheRead)} read`}
                  {cacheRead > 0 && cacheCreation > 0 &&
                    " · "}
                  {cacheCreation > 0 &&
                    `${formatCompactCount(cacheCreation)} write`}
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
        Usage data will appear here once agents start runs
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
