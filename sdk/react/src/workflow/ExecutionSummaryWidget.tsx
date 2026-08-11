"use client";

import { memo, useMemo } from "react";
import type { ExecutionSummary } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { formatDurationSec } from "./format-utils.js";

export interface ExecutionSummaryWidgetProps {
  readonly summary: ExecutionSummary | null;
  readonly isLoading: boolean;
  readonly className?: string;
}

interface StatCardDef {
  readonly label: string;
  readonly valueClass: string;
  readonly getValue: (s: ExecutionSummary) => string;
}

const PHASE_LABEL: ReadonlyMap<number, string> = new Map([
  [ExecutionPhase.EXECUTION_PENDING, "Pending"],
  [ExecutionPhase.EXECUTION_IN_PROGRESS, "Running"],
  [ExecutionPhase.EXECUTION_COMPLETED, "Completed"],
  [ExecutionPhase.EXECUTION_FAILED, "Failed"],
  [ExecutionPhase.EXECUTION_CANCELLED, "Cancelled"],
  [ExecutionPhase.EXECUTION_TERMINATED, "Terminated"],
  [ExecutionPhase.EXECUTION_PAUSED, "Paused"],
]);

const STAT_CARDS: readonly StatCardDef[] = [
  {
    label: "Active",
    valueClass: "stg:text-foreground",
    getValue: (s) => String(s.activeCount),
  },
  {
    label: "Completed",
    valueClass: "stg:text-success",
    getValue: (s) =>
      String(s.phaseCounts[ExecutionPhase.EXECUTION_COMPLETED] ?? 0),
  },
  {
    label: "Failed",
    valueClass: "stg:text-destructive",
    getValue: (s) =>
      String(s.phaseCounts[ExecutionPhase.EXECUTION_FAILED] ?? 0),
  },
  {
    label: "Total Cost",
    valueClass: "stg:text-foreground",
    getValue: (s) =>
      s.totalCost?.totalCostUsd
        ? `$${s.totalCost.totalCostUsd.toFixed(2)}`
        : "$0.00",
  },
];


/**
 * Dashboard widget showing aggregate execution KPIs.
 *
 * Displays stat cards for active, completed, failed counts and total cost.
 * Below the cards, shows average duration and a phase breakdown bar.
 *
 * All visuals use `--stgm-*` tokens. No hardcoded colors.
 */
export const ExecutionSummaryWidget = memo(function ExecutionSummaryWidget({
  summary,
  isLoading,
  className,
}: ExecutionSummaryWidgetProps) {
  const phaseBreakdown = useMemo(() => {
    if (!summary) return [];
    const entries: { label: string; count: number; colorClass: string }[] = [];
    const colorMap: Record<number, string> = {
      [ExecutionPhase.EXECUTION_PENDING]: "stg:bg-muted-foreground",
      [ExecutionPhase.EXECUTION_IN_PROGRESS]: "stg:bg-primary",
      [ExecutionPhase.EXECUTION_COMPLETED]: "stg:bg-success",
      [ExecutionPhase.EXECUTION_FAILED]: "stg:bg-destructive",
      [ExecutionPhase.EXECUTION_CANCELLED]: "stg:bg-muted-foreground",
      [ExecutionPhase.EXECUTION_TERMINATED]: "stg:bg-destructive",
      [ExecutionPhase.EXECUTION_PAUSED]: "stg:bg-muted-foreground",
    };
    for (const [phase, count] of Object.entries(summary.phaseCounts)) {
      const p = Number(phase);
      if (count > 0) {
        entries.push({
          label: PHASE_LABEL.get(p) ?? `Phase ${p}`,
          count,
          colorClass: colorMap[p] ?? "stg:bg-muted",
        });
      }
    }
    return entries;
  }, [summary]);

  const totalExecutions = phaseBreakdown.reduce((sum, e) => sum + e.count, 0);

  if (isLoading) {
    return (
      <div className={cn("stg:space-y-3", className)} aria-busy="true">
        <div className="stg:grid stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="stg:h-[72px] stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted/50"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const avgSeconds = summary.avgDuration
    ? Number(summary.avgDuration.seconds)
    : 0;

  return (
    <div className={cn("stg:space-y-4", className)}>
      <div className="stg:grid stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-4">
        {STAT_CARDS.map((card) => (
          <div
            key={card.label}
            className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-3"
          >
            <p className="stg:text-xs stg:font-medium stg:text-muted-foreground">
              {card.label}
            </p>
            <p className={cn("stg:mt-1 stg:text-2xl stg:font-semibold", card.valueClass)}>
              {card.getValue(summary)}
            </p>
          </div>
        ))}
      </div>

      {(avgSeconds > 0 || totalExecutions > 0) && (
        <div className="stg:flex stg:items-center stg:gap-6 stg:text-xs stg:text-muted-foreground">
          {avgSeconds > 0 && (
            <span>
              Avg duration:{" "}
              <span className="stg:font-medium stg:text-foreground">
                {formatDurationSec(avgSeconds)}
              </span>
            </span>
          )}
          {totalExecutions > 0 && (
            <span>
              Total:{" "}
              <span className="stg:font-medium stg:text-foreground">
                {totalExecutions}
              </span>{" "}
              executions
            </span>
          )}
        </div>
      )}

      {totalExecutions > 0 && (
        <div className="stg:space-y-2">
          <div
            className="stg:flex stg:h-2 stg:overflow-hidden stg:rounded-full stg:bg-muted"
            role="img"
            aria-label="Execution phase breakdown"
          >
            {phaseBreakdown.map((entry) => (
              <div
                key={entry.label}
                className={cn("stg:h-full", entry.colorClass)}
                style={{
                  width: `${(entry.count / totalExecutions) * 100}%`,
                }}
              />
            ))}
          </div>
          <div className="stg:flex stg:flex-wrap stg:gap-x-4 stg:gap-y-1">
            {phaseBreakdown.map((entry) => (
              <span key={entry.label} className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
                <span className={cn("stg:inline-block stg:h-2 stg:w-2 stg:rounded-full", entry.colorClass)} />
                {entry.label}: {entry.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
