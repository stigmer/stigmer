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
          "stg:px-3 stg:py-2 stg:text-left stg:text-xs stg:font-medium stg:text-muted-foreground",
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
        "stg:px-3 stg:py-2 stg:text-left stg:text-xs stg:font-medium stg:text-muted-foreground",
        className,
      )}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-sm stg:px-0.5 stg:py-0.5 stg:-mx-0.5",
          "stg:hover:text-foreground stg:transition-colors",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          sortDirection && "stg:text-foreground",
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
        "stg:shrink-0 stg:transition-transform",
        !direction && "stg:opacity-0 stg:group-hover:opacity-40",
        direction === "desc" && "stg:rotate-180",
      )}
    >
      <path d="M6 2.5v7M3 6.5l3-4 3 4" />
    </svg>
  );
}
