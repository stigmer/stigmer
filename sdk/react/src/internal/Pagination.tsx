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
  "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors",
  "hover:bg-accent hover:text-foreground",
  "disabled:pointer-events-none disabled:opacity-40",
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
      className={cn("flex items-center justify-between", className)}
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
      <span className="text-xs tabular-nums text-muted-foreground">
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
