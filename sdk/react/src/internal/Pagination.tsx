"use client";

/**
 * Shared prev/next pagination control for paginated SDK tables.
 *
 * Extracted from `CreditLedgerTable` (its original, file-private home)
 * when `ScheduleRunsTable` became the second consumer. Deliberately
 * minimal — Previous / "Page N of M" / Next — because every paginated
 * surface in the SDK so far wants exactly this shape; page-number
 * jumping earns its complexity only when a consumer actually needs it.
 *
 * Internal (not barrel-exported): the public contract is each table
 * component, not this control.
 */

import { cn } from "@stigmer/theme";

/** Props for {@link Pagination}. */
export interface PaginationProps {
  /** Current page number, 1-indexed. */
  readonly pageNum: number;
  /** Total number of pages. Render the control only when > 1. */
  readonly totalPages: number;
  /** Called with the new page number when the user navigates. */
  readonly onPageChange: (page: number) => void;
  /** Accessible label naming what is being paginated (e.g. "Run history pagination"). */
  readonly ariaLabel: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

const buttonClasses = cn(
  "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors",
  "stg:hover:bg-accent stg:hover:text-foreground",
  "stg:disabled:pointer-events-none stg:disabled:opacity-40",
);

export function Pagination({
  pageNum,
  totalPages,
  onPageChange,
  ariaLabel,
  className,
}: PaginationProps) {
  return (
    <div
      className={cn("stg:flex stg:items-center stg:justify-between", className)}
      role="navigation"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        disabled={pageNum <= 1}
        onClick={() => onPageChange(pageNum - 1)}
        className={buttonClasses}
      >
        Previous
      </button>
      <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        Page {pageNum} of {totalPages}
      </span>
      <button
        type="button"
        disabled={pageNum >= totalPages}
        onClick={() => onPageChange(pageNum + 1)}
        className={buttonClasses}
      >
        Next
      </button>
    </div>
  );
}
