"use client";

import { memo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { cn } from "@stigmer/theme";
import {
  useContextWindow,
  type ContextHealth,
  type UseContextWindowReturn,
} from "./useContextWindow.js";
import { formatTokenCount } from "./UsageWidget.js";

/** Props for {@link ContextGauge}. */
export interface ContextGaugeProps {
  /**
   * The execution snapshot from `useExecutionStream`, or `null`.
   * The gauge extracts `context_info` from the execution status.
   */
  readonly execution: AgentExecution | null;
  /**
   * When `true`, renders a minimal bar without labels.
   * Use in tight layouts (e.g., inline status indicators).
   * @default false
   */
  readonly compact?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

const HEALTH_BAR_COLORS: Record<ContextHealth, string> = {
  healthy: "stg:bg-success",
  warning: "stg:bg-warning",
  critical: "stg:bg-destructive",
};

const HEALTH_TEXT_COLORS: Record<ContextHealth, string> = {
  healthy: "stg:text-success",
  warning: "stg:text-warning",
  critical: "stg:text-destructive",
};

const HEALTH_LABELS: Record<ContextHealth, string> = {
  healthy: "Healthy",
  warning: "Approaching limit",
  critical: "Near limit",
};

function formatCompactTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

/**
 * Visual gauge showing context window utilization during agent execution.
 *
 * Renders a progress bar with threshold markers, token count labels, and
 * a health indicator derived from utilization percentage. The gauge updates
 * in real-time as the execution streams status updates.
 *
 * Returns `null` when `context_info` is absent (e.g., Cursor harness
 * where context is managed externally).
 *
 * All visual properties flow through `--stgm-*` tokens. Zero Console
 * dependencies. Accessible via `role="meter"` with ARIA value attributes.
 *
 * @example
 * ```tsx
 * const { execution } = useExecutionStream(executionId);
 * <ContextGauge execution={execution} />
 * ```
 *
 * @example Compact mode in a status bar:
 * ```tsx
 * <ContextGauge execution={execution} compact />
 * ```
 *
 * @see {@link useContextWindow} - headless hook for custom rendering
 */
export const ContextGauge = memo(function ContextGauge({
  execution,
  compact = false,
  className,
}: ContextGaugeProps) {
  const ctx = useContextWindow(execution);

  if (!ctx.hasContextInfo) return null;

  if (compact) return <CompactGauge ctx={ctx} className={className} />;

  return <FullGauge ctx={ctx} className={className} />;
});

const CompactGauge = memo(function CompactGauge({
  ctx,
  className,
}: {
  readonly ctx: UseContextWindowReturn;
  readonly className?: string;
}) {
  const barPercent = Math.min(ctx.utilizationPercent, 100);

  return (
    <div
      role="meter"
      aria-label="Context window utilization"
      aria-valuenow={ctx.currentTokenCount}
      aria-valuemin={0}
      aria-valuemax={ctx.contextWindowLimit}
      aria-valuetext={`${Math.round(ctx.utilizationPercent)}% context used`}
      className={cn("stg:flex stg:items-center stg:gap-2", className)}
    >
      <div className="stg:h-1.5 stg:flex-1 stg:overflow-hidden stg:rounded-full stg:bg-muted">
        <div
          className={cn(
            "stg:h-full stg:rounded-full stg:transition-colors",
            HEALTH_BAR_COLORS[ctx.health],
          )}
          style={{ width: `${barPercent}%` }}
        />
      </div>
      <span
        className={cn(
          "stg:shrink-0 stg:text-xs stg:tabular-nums",
          HEALTH_TEXT_COLORS[ctx.health],
        )}
      >
        {Math.round(ctx.utilizationPercent)}%
      </span>
    </div>
  );
});

const FullGauge = memo(function FullGauge({
  ctx,
  className,
}: {
  readonly ctx: UseContextWindowReturn;
  readonly className?: string;
}) {
  const barPercent = Math.min(ctx.utilizationPercent, 100);
  const triggerPercent =
    ctx.triggerThreshold > 0 && ctx.contextWindowLimit > 0
      ? (ctx.triggerThreshold / ctx.contextWindowLimit) * 100
      : 0;

  return (
    <div
      role="meter"
      aria-label="Context window utilization"
      aria-valuenow={ctx.currentTokenCount}
      aria-valuemin={0}
      aria-valuemax={ctx.contextWindowLimit}
      aria-valuetext={`${formatCompactTokens(ctx.currentTokenCount)} of ${formatCompactTokens(ctx.contextWindowLimit)} tokens used, ${Math.round(ctx.utilizationPercent)}%`}
      className={cn("stg:flex stg:flex-col stg:gap-1.5", className)}
    >
      {/* Header: label + percentage */}
      <div className="stg:flex stg:items-baseline stg:justify-between">
        <span className="stg:text-xs stg:font-medium stg:text-foreground">
          Context
        </span>
        <span
          className={cn(
            "stg:text-xs stg:tabular-nums stg:font-medium",
            HEALTH_TEXT_COLORS[ctx.health],
          )}
        >
          {Math.round(ctx.utilizationPercent)}%
        </span>
      </div>

      {/* Progress bar with threshold marker */}
      <div className="stg:relative">
        <div className="stg:h-2 stg:overflow-hidden stg:rounded-full stg:bg-muted">
          <div
            className={cn(
              "stg:h-full stg:rounded-full stg:transition-colors",
              HEALTH_BAR_COLORS[ctx.health],
            )}
            style={{ width: `${barPercent}%` }}
          />
        </div>
        {triggerPercent > 0 && triggerPercent < 100 && (
          <div
            className="stg:absolute stg:top-0 stg:h-2 stg:w-px stg:bg-muted-foreground/40"
            style={{ left: `${triggerPercent}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Token counts */}
      <div className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        {formatCompactTokens(ctx.currentTokenCount)} /{" "}
        {formatCompactTokens(ctx.contextWindowLimit)} tokens
      </div>

      {/* Health status + summarization count */}
      <div className="stg:flex stg:items-center stg:gap-1.5">
        <span
          className={cn(
            "stg:inline-flex stg:h-1.5 stg:w-1.5 stg:rounded-full",
            HEALTH_BAR_COLORS[ctx.health],
          )}
          aria-hidden="true"
        />
        <span className="stg:text-xs stg:text-muted-foreground">
          {HEALTH_LABELS[ctx.health]}
        </span>
        {ctx.summarizationEvents.length > 0 && (
          <span className="stg:text-xs stg:text-muted-foreground">
            · {ctx.summarizationEvents.length}{" "}
            {ctx.summarizationEvents.length === 1
              ? "summarization"
              : "summarizations"}
          </span>
        )}
      </div>

      {/* Summarization details (when events exist) */}
      {ctx.summarizationEvents.length > 0 && (
        <SummarizationSummary events={ctx.summarizationEvents} />
      )}
    </div>
  );
});

function SummarizationSummary({
  events,
}: {
  readonly events: UseContextWindowReturn["summarizationEvents"];
}) {
  const latest = events[events.length - 1];
  if (!latest) return null;

  return (
    <div className="stg:pl-3 stg:text-xs stg:tabular-nums stg:text-muted-foreground">
      Last: {formatTokenCount(latest.tokensBefore)} →{" "}
      {formatTokenCount(latest.tokensAfter)} tokens (
      {Math.round(latest.compressionRatio * 100)}% reduction)
    </div>
  );
}
