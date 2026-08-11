"use client";

import { cn } from "@stigmer/theme";

interface ApprovalPeekBarProps {
  /** Whether the bar is shown — typically `notFollowing && count > 0`. */
  readonly visible: boolean;
  /** Number of unresolved approvals, for the label ("1 approval needed"). */
  readonly count: number;
  /** Jumps to the live frontier where the gated tool call (and its inline approval) sits. */
  readonly onClick: () => void;
}

/**
 * Floating affordance that surfaces a pending approval the user has scrolled
 * away from. A run halts at its first approval gate, so the waiting tool call
 * sits at the live frontier — clicking jumps there (reusing the thread's
 * existing jump-to-latest), landing on the inline approval card.
 *
 * Takes the {@link JumpToLatestButton}'s slot when approvals are pending (the
 * two are mutually exclusive by the caller), styled in `warning` so a gate is
 * never missed off-screen. Always mounted for enter/exit transitions.
 *
 * @internal Not part of the public API.
 */
export function ApprovalPeekBar({ visible, count, onClick }: ApprovalPeekBarProps) {
  const label =
    count === 1 ? "1 approval needed" : `${count} approvals needed`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} — jump to it`}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "stg:absolute stg:bottom-3 stg:left-1/2 stg:z-10 stg:-translate-x-1/2",
        "stg:flex stg:items-center stg:gap-1.5 stg:rounded-full",
        "stg:border stg:border-warning/40 stg:bg-warning/10 stg:px-3 stg:py-1.5",
        "stg:text-xs stg:font-medium stg:text-warning stg:shadow-md",
        "stg:transition-[opacity,transform] stg:duration-[var(--stgm-motion-duration)]",
        "stg:hover:bg-warning/20",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        visible
          ? "stg:pointer-events-auto stg:translate-y-0 stg:opacity-100"
          : "stg:pointer-events-none stg:translate-y-2 stg:opacity-0",
      )}
    >
      <ClockIcon />
      {label}
    </button>
  );
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
    </svg>
  );
}
