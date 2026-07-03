"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { WaterfallEntry, WaterfallAttempt, WaterfallSpan } from "../execution/derive-waterfall-entries.js";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";

export interface WaterfallBarProps {
  readonly entry: WaterfallEntry;
  /** Total visible range in ms (from WaterfallScale.totalMs). */
  readonly totalMs: number;
  /** Current elapsed ms (for live-growing bars). */
  readonly nowMs: number;
  readonly className?: string;
}

type BarStatus = DerivedTaskState["status"] | "not_reached";

const STATUS_COLORS: Record<BarStatus, string> = {
  completed: "bg-[var(--stgm-success,#22c55e)]",
  running: "bg-[var(--stgm-primary,#3b82f6)]",
  failed: "bg-[var(--stgm-destructive,#ef4444)]",
  retrying: "bg-[var(--stgm-warning,#f59e0b)]",
  waiting_approval: "bg-[var(--stgm-warning,#f59e0b)]",
  skipped: "bg-[var(--stgm-muted,#d4d4d4)]",
  pending: "bg-[var(--stgm-muted,#d4d4d4)]",
  not_reached: "bg-[var(--stgm-muted,#d4d4d4)]",
};

const ATTEMPT_STATUS_COLORS: Record<WaterfallAttempt["status"], string> = {
  completed: "bg-[var(--stgm-success,#22c55e)]",
  running: "bg-[var(--stgm-primary,#3b82f6)]",
  failed: "bg-[var(--stgm-destructive,#ef4444)]",
};

/**
 * Renders the horizontal bar(s) for a single waterfall entry.
 *
 * When attempts are present (retries), renders individual attempt
 * segments with backoff gaps. Otherwise, renders a single bar.
 * Running bars animate with a pulsing trailing edge (respects
 * `prefers-reduced-motion`).
 */
export const WaterfallBar = memo(function WaterfallBar({
  entry,
  totalMs,
  nowMs,
  className,
}: WaterfallBarProps) {
  if (totalMs <= 0) return null;

  const effectiveEnd = entry.endMs ?? nowMs;

  // Use attempt segments when available
  if (entry.attempts.length > 1) {
    return (
      <div className={cn("relative h-3", className)}>
        {entry.attempts.map((attempt, i) => (
          <AttemptSegment
            key={i}
            attempt={attempt}
            totalMs={totalMs}
            nowMs={nowMs}
          />
        ))}
        {entry.children.map((child, i) => (
          <ChildSpan key={i} span={child} totalMs={totalMs} nowMs={nowMs} />
        ))}
      </div>
    );
  }

  // Single bar for non-retry tasks
  const leftPct = (entry.startMs / totalMs) * 100;
  const widthPct = ((effectiveEnd - entry.startMs) / totalMs) * 100;
  const isRunning = entry.status === "running" || entry.status === "waiting_approval";

  return (
    <div className={cn("relative h-3", className)}>
      {/* Approval wait segment (drawn first, behind main bar) */}
      {entry.approvalWaitMs != null && entry.approvalWaitMs > 0 && (
        <div
          className="absolute top-0 h-full rounded-sm bg-[var(--stgm-warning,#f59e0b)] opacity-30"
          style={{
            left: `${leftPct}%`,
            width: `${(entry.approvalWaitMs / totalMs) * 100}%`,
          }}
        />
      )}

      {/* Main bar */}
      <div
        className={cn(
          "absolute top-0.5 h-2 rounded-sm transition-[width] duration-100",
          STATUS_COLORS[entry.status],
          isRunning && "motion-safe:animate-pulse",
        )}
        style={{
          left: `${leftPct}%`,
          width: `${Math.max(widthPct, 0.2)}%`,
        }}
      />

      {/* Child spans (agent calls) */}
      {entry.children.map((child, i) => (
        <ChildSpan key={i} span={child} totalMs={totalMs} nowMs={nowMs} />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function AttemptSegment({
  attempt,
  totalMs,
  nowMs,
}: {
  readonly attempt: WaterfallAttempt;
  readonly totalMs: number;
  readonly nowMs: number;
}) {
  const effectiveEnd = attempt.endMs ?? nowMs;
  const leftPct = (attempt.startMs / totalMs) * 100;
  const widthPct = ((effectiveEnd - attempt.startMs) / totalMs) * 100;
  const isRunning = attempt.status === "running";

  return (
    <div
      className={cn(
        "absolute top-0.5 h-2 rounded-sm",
        ATTEMPT_STATUS_COLORS[attempt.status],
        isRunning && "motion-safe:animate-pulse",
      )}
      style={{
        left: `${leftPct}%`,
        width: `${Math.max(widthPct, 0.2)}%`,
      }}
    />
  );
}

function ChildSpan({
  span,
  totalMs,
  nowMs,
}: {
  readonly span: WaterfallSpan;
  readonly totalMs: number;
  readonly nowMs: number;
}) {
  const effectiveEnd = span.endMs ?? nowMs;
  const leftPct = (span.startMs / totalMs) * 100;
  const widthPct = ((effectiveEnd - span.startMs) / totalMs) * 100;

  return (
    <div
      className="absolute top-1 h-1 rounded-sm bg-[var(--stgm-chart-purple,#8b5cf6)] opacity-60"
      style={{
        left: `${leftPct}%`,
        width: `${Math.max(widthPct, 0.15)}%`,
      }}
    />
  );
}
