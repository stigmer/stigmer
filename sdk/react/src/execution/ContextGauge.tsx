"use client";

import { memo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { cn } from "@stigmer/theme";
import {
  useContextWindow,
  type ContextHealth,
  type UseContextWindowReturn,
} from "./useContextWindow";
import { formatTokenCount } from "./UsageWidget";

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
  healthy: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
};

const HEALTH_TEXT_COLORS: Record<ContextHealth, string> = {
  healthy: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
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
      className={cn("flex items-center gap-2", className)}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-colors",
            HEALTH_BAR_COLORS[ctx.health],
          )}
          style={{ width: `${barPercent}%` }}
        />
      </div>
      <span
        className={cn(
          "shrink-0 text-xs tabular-nums",
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
      className={cn("flex flex-col gap-1.5", className)}
    >
      {/* Header: label + percentage */}
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-foreground">
          Context
        </span>
        <span
          className={cn(
            "text-xs tabular-nums font-medium",
            HEALTH_TEXT_COLORS[ctx.health],
          )}
        >
          {Math.round(ctx.utilizationPercent)}%
        </span>
      </div>

      {/* Progress bar with threshold marker */}
      <div className="relative">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-colors",
              HEALTH_BAR_COLORS[ctx.health],
            )}
            style={{ width: `${barPercent}%` }}
          />
        </div>
        {triggerPercent > 0 && triggerPercent < 100 && (
          <div
            className="absolute top-0 h-2 w-px bg-muted-foreground/40"
            style={{ left: `${triggerPercent}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Token counts */}
      <div className="text-xs tabular-nums text-muted-foreground">
        {formatCompactTokens(ctx.currentTokenCount)} /{" "}
        {formatCompactTokens(ctx.contextWindowLimit)} tokens
      </div>

      {/* Health status + summarization count */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex h-1.5 w-1.5 rounded-full",
            HEALTH_BAR_COLORS[ctx.health],
          )}
          aria-hidden="true"
        />
        <span className="text-xs text-muted-foreground">
          {HEALTH_LABELS[ctx.health]}
        </span>
        {ctx.summarizationEvents.length > 0 && (
          <span className="text-xs text-muted-foreground">
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
    <div className="pl-3 text-xs tabular-nums text-muted-foreground">
      Last: {formatTokenCount(latest.tokensBefore)} →{" "}
      {formatTokenCount(latest.tokensAfter)} tokens (
      {Math.round(latest.compressionRatio * 100)}% reduction)
    </div>
  );
}
