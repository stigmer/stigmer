"use client";

import { memo } from "react";
import type { CompactedItem } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";

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
 * Where the agent's earlier messages were summarized to make room
 * (`agent.thread_context_compacted`): a hairline marker at that place among
 * the turn's items, as the agent-version marker draws a quiet event, with
 * the time it happened. The quietest event in the thread reads as the
 * quietest line.
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
      aria-label="Earlier messages summarized"
      className={cn("stg:flex stg:items-center stg:gap-3 stg:px-4 stg:py-2 stg:text-xs stg:text-muted-foreground", className)}
    >
      <span aria-hidden="true" className="stg:h-px stg:flex-1 stg:bg-border" />
      <span className="stg:tabular-nums">
        Earlier messages summarized
        {compacted.processedAt && (
          <>
            {" · "}
            <time dateTime={compacted.processedAt}>{formatTime(compacted.processedAt)}</time>
          </>
        )}
      </span>
      <span aria-hidden="true" className="stg:h-px stg:flex-1 stg:bg-border" />
    </div>
  );
});

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
