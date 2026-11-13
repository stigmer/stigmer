"use client";

// The console's one status pill: a dot and a word on the status tint, 12px
// on a 20px pill. Every state in the console (a session, a run, a routine's
// fire, a provider, an invite, a version) reads through it, so a state looks
// the same wherever it shows, and a neutral word never borrows its look
// (`Tag` is the neutral label).

import { cn } from "@stigmer/design-tokens";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import type { StatusPhase } from "../resource-workbench/types.js";

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
 * defined in `@stigmer/design-tokens`, ensuring correct appearance in both light
 * and dark modes.
 *
 * @example
 * ```tsx
 * <>
 *   <StatusBadge phase="ready" />
 *   <StatusBadge phase="failed" label="Unreachable" tooltip="Last checked 2m ago" />
 * </>
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
        "stg:inline-flex stg:h-5 stg:shrink-0 stg:items-center stg:gap-1.5 stg:whitespace-nowrap stg:rounded-full stg:px-2 stg:text-xs stg:font-medium",
        statusClasses(phase),
        className,
      )}
    >
      <span
        className={cn("stg:size-1.5 stg:shrink-0 stg:rounded-full", dotClasses(phase))}
        aria-hidden="true"
      />
      {displayLabel}
    </span>
  );

  if (!tooltip) return badge;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="stg:inline-flex" />}>
        {badge}
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Maps a status phase to Tailwind classes using `--stgm-status-*` tokens.
 * Background uses the `-subtle` variant; text uses the main status color.
 */
function statusClasses(phase: StatusPhase): string {
  switch (phase) {
    case "ready":
      return "stg:bg-[var(--stgm-status-ready-subtle)] stg:text-[var(--stgm-status-ready)]";
    case "running":
      return "stg:bg-[var(--stgm-status-running-subtle)] stg:text-[var(--stgm-status-running)]";
    case "pending":
      return "stg:bg-[var(--stgm-status-pending-subtle)] stg:text-[var(--stgm-status-pending)]";
    case "degraded":
      return "stg:bg-[var(--stgm-status-degraded-subtle)] stg:text-[var(--stgm-status-degraded)]";
    case "failed":
      return "stg:bg-[var(--stgm-status-failed-subtle)] stg:text-[var(--stgm-status-failed)]";
    case "disabled":
      return "stg:bg-[var(--stgm-status-disabled-subtle)] stg:text-[var(--stgm-status-disabled)]";
    case "draft":
      return "stg:bg-[var(--stgm-status-draft-subtle)] stg:text-[var(--stgm-status-draft)]";
  }
}

/** Maps a status phase to the dot's background color (the main token). */
function dotClasses(phase: StatusPhase): string {
  switch (phase) {
    case "ready":
      return "stg:bg-[var(--stgm-status-ready)]";
    case "running":
      return "stg:bg-[var(--stgm-status-running)]";
    case "pending":
      return "stg:bg-[var(--stgm-status-pending)]";
    case "degraded":
      return "stg:bg-[var(--stgm-status-degraded)]";
    case "failed":
      return "stg:bg-[var(--stgm-status-failed)]";
    case "disabled":
      return "stg:bg-[var(--stgm-status-disabled)]";
    case "draft":
      return "stg:bg-[var(--stgm-status-draft)]";
  }
}
