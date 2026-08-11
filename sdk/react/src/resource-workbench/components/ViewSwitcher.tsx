"use client";

import { cn } from "@stigmer/theme";
import type { ViewMode } from "../types.js";

/** Props for {@link ViewSwitcher}. */
export interface ViewSwitcherProps {
  /** Currently active view mode. */
  readonly value: ViewMode;
  /** Called when the user selects a different view mode. */
  readonly onChange: (mode: ViewMode) => void;
  /** Which view modes to show. @default ["table", "cards", "list"] */
  readonly modes?: readonly ViewMode[];
  /** Additional CSS classes. */
  readonly className?: string;
}

const MODE_META: Record<ViewMode, { label: string; icon: () => React.JSX.Element }> = {
  table: { label: "Table view", icon: TableIcon },
  cards: { label: "Card view", icon: CardsIcon },
  list: { label: "List view", icon: ListIcon },
};

/**
 * Toggle button group for switching between table, cards, and list views.
 *
 * Uses `role="radiogroup"` with `role="radio"` children for accessible
 * view switching. Each button shows an icon and is labeled for screen
 * readers.
 */
export function ViewSwitcher({
  value,
  onChange,
  modes = ["table", "cards", "list"],
  className,
}: ViewSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className={cn("stg:inline-flex stg:rounded-md stg:border stg:border-input", className)}
    >
      {modes.map((mode) => {
        const { label, icon: Icon } = MODE_META[mode];
        const isActive = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            onClick={() => onChange(mode)}
            className={cn(
              "stg:inline-flex stg:items-center stg:justify-center stg:px-2 stg:py-1.5 stg:transition-colors",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:z-10",
              "stg:first:rounded-l-[calc(var(--stgm-radius)-1px)] stg:last:rounded-r-[calc(var(--stgm-radius)-1px)]",
              "stg:border-r stg:border-input stg:last:border-r-0",
              isActive
                ? "stg:bg-accent stg:text-accent-foreground"
                : "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            )}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVGs matching the SDK's icon pattern)
// ---------------------------------------------------------------------------

function TableIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
      <path d="M1.5 5.5h11M1.5 9h11M5.5 5.5v6" />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" />
      <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" />
      <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" />
      <rect x="8" y="8" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 3h8M4.5 7h8M4.5 11h8" />
      <circle cx="2" cy="3" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="2" cy="7" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="2" cy="11" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
