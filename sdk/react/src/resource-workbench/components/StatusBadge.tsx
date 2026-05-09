"use client";

import { cn } from "@stigmer/theme";
import type { StatusPhase } from "../types";

/** Props for {@link StatusBadge}. */
export interface StatusBadgeProps {
  /** The status phase to display. Maps to `--stgm-status-*` tokens. */
  readonly phase: StatusPhase;
  /**
   * Optional human-readable label override. When omitted, the phase
   * name is title-cased (e.g. "ready" becomes "Ready").
   */
  readonly label?: string;
  /** Tooltip text shown on hover. When omitted, no tooltip renders. */
  readonly tooltip?: string;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

const PHASE_LABELS: Record<StatusPhase, string> = {
  ready: "Ready",
  running: "Running",
  pending: "Pending",
  degraded: "Degraded",
  failed: "Failed",
  disabled: "Disabled",
  draft: "Draft",
};

/**
 * Accessible status indicator that combines a color dot with a text label.
 *
 * Never communicates status through color alone — the text label is always
 * present (WCAG 1.4.1). Colors come from `--stgm-status-*` design tokens
 * defined in `@stigmer/theme`, ensuring correct appearance in both light
 * and dark modes.
 *
 * @example
 * ```tsx
 * <StatusBadge phase="ready" />
 * <StatusBadge phase="failed" label="Unreachable" tooltip="Last checked 2m ago" />
 * ```
 */
export function StatusBadge({
  phase,
  label,
  tooltip,
  className,
}: StatusBadgeProps) {
  const displayLabel = label ?? PHASE_LABELS[phase];

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
        statusClasses(phase),
        className,
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", dotClasses(phase))}
        aria-hidden="true"
      />
      {displayLabel}
    </span>
  );

  if (!tooltip) return badge;

  return (
    <span title={tooltip} className="inline-flex">
      {badge}
    </span>
  );
}

/**
 * Maps a status phase to Tailwind classes using `--stgm-status-*` tokens.
 * Background uses the `-subtle` variant; text uses the main status color.
 */
function statusClasses(phase: StatusPhase): string {
  switch (phase) {
    case "ready":
      return "bg-[var(--stgm-status-ready-subtle)] text-[var(--stgm-status-ready)]";
    case "running":
      return "bg-[var(--stgm-status-running-subtle)] text-[var(--stgm-status-running)]";
    case "pending":
      return "bg-[var(--stgm-status-pending-subtle)] text-[var(--stgm-status-pending)]";
    case "degraded":
      return "bg-[var(--stgm-status-degraded-subtle)] text-[var(--stgm-status-degraded)]";
    case "failed":
      return "bg-[var(--stgm-status-failed-subtle)] text-[var(--stgm-status-failed)]";
    case "disabled":
      return "bg-[var(--stgm-status-disabled-subtle)] text-[var(--stgm-status-disabled)]";
    case "draft":
      return "bg-[var(--stgm-status-draft-subtle)] text-[var(--stgm-status-draft)]";
  }
}

/** Maps a status phase to the dot's background color (the main token). */
function dotClasses(phase: StatusPhase): string {
  switch (phase) {
    case "ready":
      return "bg-[var(--stgm-status-ready)]";
    case "running":
      return "bg-[var(--stgm-status-running)]";
    case "pending":
      return "bg-[var(--stgm-status-pending)]";
    case "degraded":
      return "bg-[var(--stgm-status-degraded)]";
    case "failed":
      return "bg-[var(--stgm-status-failed)]";
    case "disabled":
      return "bg-[var(--stgm-status-disabled)]";
    case "draft":
      return "bg-[var(--stgm-status-draft)]";
  }
}
