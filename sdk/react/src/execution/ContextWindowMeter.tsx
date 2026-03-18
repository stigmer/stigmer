"use client";

import type { ContextInfo } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/context_pb";
import { cn } from "@stigmer/theme";
import { formatCompactNumber } from "./execution-format";

export interface ContextWindowMeterProps {
  /** Context window information from the execution status. Renders nothing when undefined or when the context window limit is zero. */
  readonly contextInfo?: ContextInfo;
  readonly className?: string;
}

/**
 * Displays context window utilization as a color-coded progress bar
 * with current and limit token counts.
 *
 * Color thresholds: green (<70%), yellow (70–90%), red (>=90%).
 *
 * Renders its content without card chrome (no border, background, or
 * elevation). The consumer controls the container styling.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const stream = useExecutionStream(executionId);
 *
 * <ContextWindowMeter
 *   contextInfo={stream.execution?.status?.contextInfo}
 * />
 * ```
 */
export function ContextWindowMeter({
  contextInfo,
  className,
}: ContextWindowMeterProps) {
  if (!contextInfo || contextInfo.contextWindowLimit <= 0) return null;

  const pct = Math.min(100, Math.max(0, contextInfo.utilizationPercent));
  const barColor =
    pct >= 90
      ? "bg-destructive"
      : pct >= 70
        ? "bg-warning"
        : "bg-success";

  return (
    <div
      role="meter"
      aria-label="Context window utilization"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("flex flex-col gap-1", className)}
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            barColor,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {formatCompactNumber(contextInfo.currentTokenCount)} /{" "}
          {formatCompactNumber(contextInfo.contextWindowLimit)}
        </span>
        <span>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}
