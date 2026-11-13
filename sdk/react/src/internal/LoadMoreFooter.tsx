"use client";

/**
 * The "Load more" footer every accumulating SDK list renders under its
 * rows: the error of the last failed `loadMore`, then the button while the
 * server holds more. It pairs with `useCursorPages`, whose return carries
 * exactly these fields; the list panels pass them through.
 *
 * Internal (not barrel-exported): the public contract is each panel.
 */

import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { Button } from "../button/Button.js";

/** Props for {@link LoadMoreFooter}. */
export interface LoadMoreFooterProps {
  /** `true` while the server holds rows beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next page. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

export function LoadMoreFooter({
  hasMore,
  loadMore,
  isLoadingMore,
  loadMoreError,
  className,
}: LoadMoreFooterProps) {
  if (!hasMore && loadMoreError === null) return null;
  return (
    <div className={cn("stg:mt-2 stg:flex stg:flex-col stg:items-start stg:gap-1", className)}>
      {loadMoreError !== null && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(loadMoreError)}
        </p>
      )}
      {hasMore && (
        <Button variant="ghost" size="xs" onClick={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
