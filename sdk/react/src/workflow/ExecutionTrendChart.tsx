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
    { label: "Completed", colorClass: "text-success", bgColorClass: "bg-success" },
  ],
  [
    ExecutionPhase.EXECUTION_FAILED,
    { label: "Failed", colorClass: "text-destructive", bgColorClass: "bg-destructive" },
  ],
  [
    ExecutionPhase.EXECUTION_IN_PROGRESS,
    { label: "Running", colorClass: "text-primary", bgColorClass: "bg-primary" },
  ],
  [
    ExecutionPhase.EXECUTION_PENDING,
    { label: "Pending", colorClass: "text-muted-foreground", bgColorClass: "bg-muted-foreground" },
  ],
  [
    ExecutionPhase.EXECUTION_PAUSED,
    { label: "Paused", colorClass: "text-muted-foreground", bgColorClass: "bg-muted-foreground/60" },
  ],
  [
    ExecutionPhase.EXECUTION_CANCELLED,
    { label: "Cancelled", colorClass: "text-muted-foreground", bgColorClass: "bg-muted-foreground/40" },
  ],
  [
    ExecutionPhase.EXECUTION_TERMINATED,
    { label: "Terminated", colorClass: "text-destructive", bgColorClass: "bg-destructive/60" },
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
      <div className={cn("space-y-3", className)} aria-busy="true">
        <div className="h-4 w-36 animate-pulse rounded bg-muted" />
        <div className="h-8 animate-pulse rounded-full bg-muted/50" />
        <div className="flex gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-3 w-16 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary || total === 0) {
    return (
      <div className={cn("space-y-3", className)}>
        <h3 className="text-sm font-semibold text-foreground">
          Execution Distribution
        </h3>
        <p className="py-6 text-center text-xs text-muted-foreground">
          No execution data available
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Execution Distribution
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {total} total
        </span>
      </div>

      <div
        className="flex h-3 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label="Execution phase distribution"
      >
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={cn("h-full transition-all duration-500", seg.bgColorClass)}
            style={{ width: `${(seg.count / total) * 100}%` }}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((seg) => (
          <span
            key={seg.label}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className={cn(
                "inline-block h-2.5 w-2.5 rounded-sm",
                seg.bgColorClass,
              )}
            />
            <span>{seg.label}</span>
            <span className={cn("font-semibold tabular-nums", seg.colorClass)}>
              {seg.count}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
});
