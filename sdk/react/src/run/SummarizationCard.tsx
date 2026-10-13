"use client";

import { memo } from "react";
import type { CompactedItem } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";

/** Props for {@link SummarizationCard}. */
export interface SummarizationCardProps {
  /**
   * The compaction, as the session's fold holds it
   * (`agent.thread_context_compacted`).
   */
  readonly compacted: CompactedItem;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Inline timeline card shown where the agent's context was compacted
 * mid-conversation: a compact system-event divider in the
 * {@link MessageThread}, at the compaction's place among the turn's items,
 * with the time it happened.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export const SummarizationCard = memo(function SummarizationCard({
  compacted,
  className,
}: SummarizationCardProps) {
  return (
    <div
      role="status"
      aria-label="Context compacted"
      className={cn(
        "stg:mx-4 stg:flex stg:items-center stg:gap-3 stg:rounded-md stg:border stg:border-border-muted",
        "stg:bg-muted-faint stg:px-3 stg:py-2",
        className,
      )}
    >
      <CompactionIcon />
      <div className="stg:flex stg:min-w-0 stg:flex-1 stg:items-baseline stg:gap-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
        <span>Context compacted</span>
        {compacted.processedAt && (
          <time dateTime={compacted.processedAt} className="stg:ml-auto stg:tabular-nums stg:text-muted-foreground-subtle">
            {formatTime(compacted.processedAt)}
          </time>
        )}
      </div>
    </div>
  );
});

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function CompactionIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0 stg:text-muted-foreground-subtle"
      aria-hidden="true"
    >
      <path d="M4 2v4l4-2-4-2zM12 14v-4l-4 2 4 2z" />
      <path d="M4 8h8" />
    </svg>
  );
}
