"use client";

import { cn } from "@stigmer/theme";

interface JumpToLatestButtonProps {
  readonly onClick: () => void;
  readonly visible: boolean;
}

/**
 * Floating action button that scrolls the thread to the latest content.
 * Always mounted in the DOM to support enter/exit CSS transitions.
 * Hidden via opacity + pointer-events when `visible` is false.
 *
 * @internal Not part of the public API.
 */
export function JumpToLatestButton({ onClick, visible }: JumpToLatestButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Jump to latest"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "absolute bottom-3 left-1/2 z-10 -translate-x-1/2",
        "flex items-center gap-1.5 rounded-full",
        "border border-border bg-card px-3 py-1.5",
        "text-xs font-medium text-muted-foreground shadow-md",
        "transition-[opacity,transform] duration-[var(--stgm-motion-duration)]",
        "hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
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
