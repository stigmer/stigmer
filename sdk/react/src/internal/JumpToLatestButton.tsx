"use client";

import { cn } from "@stigmer/theme";

interface JumpToLatestButtonProps {
  readonly onClick: () => void;
}

/**
 * Floating action button that scrolls the thread to the latest content.
 * Rendered when the auto-scroll state machine is in the Disengaged state.
 *
 * @internal Not part of the public API.
 */
export function JumpToLatestButton({ onClick }: JumpToLatestButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Jump to latest"
      className={cn(
        "absolute bottom-3 left-1/2 z-10 -translate-x-1/2",
        "flex items-center gap-1.5 rounded-full",
        "border border-border bg-card px-3 py-1.5",
        "text-xs font-medium text-muted-foreground shadow-md",
        "transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <ChevronDownIcon />
      Jump to latest
    </button>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
