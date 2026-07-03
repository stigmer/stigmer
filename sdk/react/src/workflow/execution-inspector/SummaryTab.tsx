"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { TaskDetailSummary } from "./derive-task-detail.js";
import { formatDuration, formatMicroUsd, formatTokenCount, formatTimestamp } from "../format-utils.js";

export interface SummaryTabProps {
  readonly summary: TaskDetailSummary;
  readonly className?: string;
}

export const SummaryTab = memo(function SummaryTab({ summary, className }: SummaryTabProps) {
  const BZ = BigInt(0);
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs", className)}>
      {summary.startedAt && (
        <>
          <dt className="text-muted-foreground">Started</dt>
          <dd className="text-foreground">{formatTimestamp(summary.startedAt)}</dd>
        </>
      )}
      {summary.completedAt && (
        <>
          <dt className="text-muted-foreground">Completed</dt>
          <dd className="text-foreground">{formatTimestamp(summary.completedAt)}</dd>
        </>
      )}
      {summary.durationMs > 0 && (
        <>
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="tabular-nums text-foreground">{formatDuration(summary.durationMs)}</dd>
        </>
      )}
      {summary.costMicros > BZ && (
        <>
          <dt className="text-muted-foreground">Cost</dt>
          <dd className="tabular-nums text-foreground">{formatMicroUsd(summary.costMicros)}</dd>
        </>
      )}
      {summary.totalTokens > BZ && (
        <>
          <dt className="text-muted-foreground">Tokens</dt>
          <dd className="tabular-nums text-foreground">
            {formatTokenCount(summary.totalTokens)}
            {summary.inputTokens > BZ && summary.outputTokens > BZ && (
              <span className="ml-1 text-muted-foreground">
                ({formatTokenCount(summary.inputTokens)} in / {formatTokenCount(summary.outputTokens)} out)
              </span>
            )}
          </dd>
        </>
      )}
      {summary.attemptNumber > 1 && (
        <>
          <dt className="text-muted-foreground">Attempt</dt>
          <dd className="text-foreground">{summary.attemptNumber}</dd>
        </>
      )}
    </dl>
  );
});
