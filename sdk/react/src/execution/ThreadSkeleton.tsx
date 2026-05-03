"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link ThreadSkeleton}. */
export interface ThreadSkeletonProps {
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

const AI_LINE_WIDTHS = [
  [85, 72, 90],
  [78, 65, 88, 70],
] as const;

/**
 * Pulse-animated skeleton that mimics the shape of a conversation
 * thread. Renders alternating human-bubble and AI-response
 * silhouettes so the loading state feels purposeful.
 *
 * Intended as an opt-in building block for consumers to show while
 * session data loads. Not auto-rendered by {@link MessageThread}.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * if (isLoading) return <ThreadSkeleton className="flex-1" />;
 * ```
 */
export function ThreadSkeleton({ className }: ThreadSkeletonProps) {
  return (
    <div
      className={cn("flex flex-col gap-4 pt-6 pb-4", className)}
      aria-busy="true"
      aria-label="Loading conversation"
    >
      <div className="animate-pulse space-y-4">
        {/* Turn 1: Human bubble */}
        <div className="ms-[20%] rounded-lg bg-muted-subtle px-4 py-3">
          <div className="h-4 w-3/5 rounded bg-muted" />
        </div>

        {/* Turn 1: AI response */}
        <div className="space-y-2 px-4">
          {AI_LINE_WIDTHS[0].map((w, i) => (
            <div
              key={i}
              className="h-4 rounded bg-muted"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>

        {/* Turn 2: Human bubble */}
        <div className="ms-[20%] rounded-lg bg-muted-subtle px-4 py-3">
          <div className="h-4 w-2/5 rounded bg-muted" />
        </div>

        {/* Turn 2: AI response */}
        <div className="space-y-2 px-4">
          {AI_LINE_WIDTHS[1].map((w, i) => (
            <div
              key={i}
              className="h-4 rounded bg-muted"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
