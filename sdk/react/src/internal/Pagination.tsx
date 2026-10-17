"use client";

/**
 * Shared previous/next pager for paginated SDK tables.
 *
 * Lists page by token and carry no total, so the control says where the
 * reader is ("Page 3") and whether a page follows. A view that pages a
 * set it holds in memory knows its page count and passes it ("Page 3 of
 * 7"). Its consumers are `RoutineFiresTable` (by token) and the
 * marketplace catalog (in memory).
 *
 * Internal (not barrel-exported): the public contract is each table
 * component, not this control.
 */

import { cn } from "@stigmer/theme";

/** Props for {@link Pagination}. */
export interface PaginationProps {
  /** The shown page's number, 1-indexed. */
  readonly pageNumber: number;
  /** `true` when a page was shown before this one. */
  readonly hasPrevious: boolean;
  /** `true` when a page follows this one. */
  readonly hasNext: boolean;
  /** Show the page before. */
  readonly onPrevious: () => void;
  /** Show the next page. */
  readonly onNext: () => void;
  /** The number of pages, when the view knows it (a set held in memory). */
  readonly pageCount?: number;
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
  pageNumber,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  pageCount,
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
        disabled={!hasPrevious}
        onClick={onPrevious}
        className={buttonClasses}
      >
        Previous
      </button>
      <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        {pageCount === undefined ? `Page ${pageNumber}` : `Page ${pageNumber} of ${pageCount}`}
      </span>
      <button
        type="button"
        disabled={!hasNext}
        onClick={onNext}
        className={buttonClasses}
      >
        Next
      </button>
    </div>
  );
}
