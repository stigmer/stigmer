"use client";

import { cn } from "@stigmer/theme";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { phaseLabel, phaseDotColor } from "./phase";

// ---------------------------------------------------------------------------
// RunnerIcon
// ---------------------------------------------------------------------------

/** Props for {@link RunnerIcon}. */
export interface RunnerIconProps {
  readonly size?: number;
  readonly className?: string;
}

/**
 * CPU-chip icon representing a runner. Used across the runner list,
 * fleet section, and empty states.
 */
export function RunnerIcon({ size = 14, className }: RunnerIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// PhaseBadge
// ---------------------------------------------------------------------------

/** Props for {@link PhaseBadge}. */
export interface PhaseBadgeProps {
  readonly phase: RunnerPhase;
}

/**
 * Compact badge showing a colored dot indicator and label for a runner
 * phase. Renders a spinning indicator for the STARTING phase.
 */
export function PhaseBadge({ phase }: PhaseBadgeProps) {
  const starting = phase === RunnerPhase.STARTING;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {starting ? (
        <span
          className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-primary border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${phaseDotColor(phase)}`}
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "text-[0.65rem]",
          starting ? "text-primary" : "text-muted-foreground",
        )}
      >
        {phaseLabel(phase)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

/**
 * Formats a Date as a compact relative time string.
 *
 * - < 60s → "just now"
 * - < 60m → "5m ago"
 * - < 24h → "3h ago"
 * - < 30d → "12d ago"
 * - otherwise → locale short date
 */
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
