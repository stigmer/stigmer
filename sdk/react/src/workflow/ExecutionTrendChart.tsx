"use client";

import { memo, useMemo } from "react";
import type { ExecutionSummary } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";

export interface ExecutionTrendChartProps {
  readonly summary: ExecutionSummary | null;
  readonly isLoading: boolean;
  readonly className?: string;
}

interface PhaseSegment {
  readonly label: string;
  readonly count: number;
  readonly colorClass: string;
  readonly bgColorClass: string;
}

const PHASE_DISPLAY: ReadonlyMap<
  number,
  { label: string; colorClass: string; bgColorClass: string }
> = new Map([
  [
    ExecutionPhase.EXECUTION_COMPLETED,
    { label: "Completed", colorClass: "stg:text-success", bgColorClass: "stg:bg-success" },
  ],
  [
    ExecutionPhase.EXECUTION_FAILED,
    { label: "Failed", colorClass: "stg:text-destructive", bgColorClass: "stg:bg-destructive" },
  ],
  [
    ExecutionPhase.EXECUTION_IN_PROGRESS,
    { label: "Running", colorClass: "stg:text-primary", bgColorClass: "stg:bg-primary" },
  ],
  [
    ExecutionPhase.EXECUTION_PENDING,
    { label: "Pending", colorClass: "stg:text-muted-foreground", bgColorClass: "stg:bg-muted-foreground" },
  ],
  [
    ExecutionPhase.EXECUTION_PAUSED,
    { label: "Paused", colorClass: "stg:text-muted-foreground", bgColorClass: "stg:bg-muted-foreground/60" },
  ],
  [
    ExecutionPhase.EXECUTION_CANCELLED,
    { label: "Cancelled", colorClass: "stg:text-muted-foreground", bgColorClass: "stg:bg-muted-foreground/40" },
  ],
  [
    ExecutionPhase.EXECUTION_TERMINATED,
    { label: "Terminated", colorClass: "stg:text-destructive", bgColorClass: "stg:bg-destructive/60" },
  ],
]);

/**
 * Phase distribution chart for workflow executions.
 *
 * Shows a stacked horizontal bar with a legend listing each phase
 * and its count. Renders from `ExecutionSummary.phaseCounts`.
 */
export const ExecutionTrendChart = memo(function ExecutionTrendChart({
  summary,
  isLoading,
  className,
}: ExecutionTrendChartProps) {
  const segments: PhaseSegment[] = useMemo(() => {
    if (!summary) return [];
    const result: PhaseSegment[] = [];
    for (const [phase, count] of Object.entries(summary.phaseCounts)) {
      const p = Number(phase);
      if (count <= 0) continue;
      const display = PHASE_DISPLAY.get(p);
      if (!display) continue;
      result.push({ ...display, count });
    }
    return result.sort((a, b) => b.count - a.count);
  }, [summary]);

  const total = useMemo(
    () => segments.reduce((sum, s) => sum + s.count, 0),
    [segments],
  );

  if (isLoading) {
    return (
      <div className={cn("stg:space-y-3", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-36 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:h-8 stg:animate-pulse stg:rounded-full stg:bg-muted/50" />
        <div className="stg:flex stg:gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="stg:h-3 stg:w-16 stg:animate-pulse stg:rounded stg:bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary || total === 0) {
    return (
      <div className={cn("stg:space-y-3", className)}>
        <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">
          Execution Distribution
        </h3>
        <p className="stg:py-6 stg:text-center stg:text-xs stg:text-muted-foreground">
          No execution data available
        </p>
      </div>
    );
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      <div className="stg:flex stg:items-baseline stg:justify-between">
        <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">
          Execution Distribution
        </h3>
        <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
          {total} total
        </span>
      </div>

      <div
        className="stg:flex stg:h-3 stg:overflow-hidden stg:rounded-full stg:bg-muted"
        role="img"
        aria-label="Execution phase distribution"
      >
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={cn("stg:h-full stg:transition-all stg:duration-500", seg.bgColorClass)}
            style={{ width: `${(seg.count / total) * 100}%` }}
          />
        ))}
      </div>

      <div className="stg:flex stg:flex-wrap stg:gap-x-4 stg:gap-y-1.5">
        {segments.map((seg) => (
          <span
            key={seg.label}
            className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground"
          >
            <span
              className={cn(
                "stg:inline-block stg:h-2.5 stg:w-2.5 stg:rounded-sm",
                seg.bgColorClass,
              )}
            />
            <span>{seg.label}</span>
            <span className={cn("stg:font-semibold stg:tabular-nums", seg.colorClass)}>
              {seg.count}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
});
