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
        "stg:absolute stg:bottom-3 stg:left-1/2 stg:z-10 stg:-translate-x-1/2",
        "stg:flex stg:items-center stg:gap-1.5 stg:rounded-full",
        "stg:border stg:border-border stg:bg-card stg:px-3 stg:py-1.5",
        "stg:text-xs stg:font-medium stg:text-muted-foreground stg:shadow-md",
        "stg:transition-[opacity,transform] stg:duration-[var(--stgm-motion-duration)]",
        "stg:hover:bg-muted stg:hover:text-foreground",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        visible
          ? "stg:pointer-events-auto stg:translate-y-0 stg:opacity-100"
          : "stg:pointer-events-none stg:translate-y-2 stg:opacity-0",
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
