"use client";

import { cn } from "@stigmer/design-tokens";
import { LoadingRegion } from "../internal/LoadingRegion.js";

/** Props for {@link ThreadSkeleton}. */
export interface ThreadSkeletonProps {
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The conversation's shape while it loads, in outline: the header's title
 * and meta line, the first message, the start of the answer. The same
 * shapes the session viewer draws while a new session is being made, so
 * loading and starting look alike; no words, since nothing is known yet.
 *
 * Intended as an opt-in building block for consumers to show while
 * session data loads. Not auto-rendered by {@link MessageThread}.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * function Thread({ isLoading, children }: { isLoading: boolean; children: ReactNode }) {
 *   return isLoading ? <ThreadSkeleton className="flex-1" /> : children;
 * }
 * ```
 */
export function ThreadSkeleton({ className }: ThreadSkeletonProps) {
  return (
    <LoadingRegion className={cn("stg:flex stg:flex-col stg:gap-5 stg:pt-6 stg:pb-4", className)} label="Loading conversation">
      <div className="stg:space-y-2 stg:border-b stg:border-border stg:px-4 stg:pb-4">
        <div className="stg:h-5 stg:w-56 stg:max-w-full stg:animate-pulse stg:rounded-md stg:bg-muted" />
        <div className="stg:h-3 stg:w-36 stg:max-w-full stg:animate-pulse stg:rounded-md stg:bg-muted" />
      </div>
      <div className="stg:mx-4 stg:h-16 stg:w-3/5 stg:self-end stg:animate-pulse stg:rounded-xl stg:bg-muted" />
      <div className="stg:space-y-2 stg:px-4">
        <div className="stg:h-3 stg:w-[88%] stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:h-3 stg:w-[72%] stg:animate-pulse stg:rounded stg:bg-muted" />
      </div>
    </LoadingRegion>
  );
}
