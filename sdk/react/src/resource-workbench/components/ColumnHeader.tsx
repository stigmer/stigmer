"use client";

import { cn } from "@stigmer/theme";
import type { SortDirection } from "../types.js";

/** Props for {@link ColumnHeader}. */
export interface ColumnHeaderProps {
  /** Column header label. */
  readonly label: string;
  /** Whether clicking this header toggles sort. */
  readonly sortable: boolean;
  /** Current sort direction for this column, or `null` if not sorted. */
  readonly sortDirection: SortDirection | null;
  /** Called when the user clicks a sortable header. */
  readonly onSort?: () => void;
  /** Additional CSS classes. */
  readonly className?: string;
}

/**
 * Sortable table column header with accessible sort indicators.
 *
 * Uses `aria-sort` to communicate sort state to screen readers.
 * The sort indicator uses both an icon and text direction so the
 * sort state is never conveyed by icon alone.
 */
export function ColumnHeader({
  label,
  sortable,
  sortDirection,
  onSort,
  className,
}: ColumnHeaderProps) {
  const ariaSort = sortDirection === "asc"
    ? "ascending" as const
    : sortDirection === "desc"
      ? "descending" as const
      : undefined;

  if (!sortable) {
    return (
      <th
        scope="col"
        className={cn(
          "px-3 py-2 text-left text-xs font-medium text-muted-foreground",
          className,
        )}
      >
        {label}
      </th>
    );
  }

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "px-3 py-2 text-left text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm px-0.5 py-0.5 -mx-0.5",
          "hover:text-foreground transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          sortDirection && "text-foreground",
        )}
      >
        {label}
        <SortIndicator direction={sortDirection} />
      </button>
    </th>
  );
}

function SortIndicator({
  direction,
}: {
  readonly direction: SortDirection | null;
}) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "shrink-0 transition-transform",
        !direction && "opacity-0 group-hover:opacity-40",
        direction === "desc" && "rotate-180",
      )}
    >
      <path d="M6 2.5v7M3 6.5l3-4 3 4" />
    </svg>
  );
}
