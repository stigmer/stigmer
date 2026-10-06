"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { SummarizationEventView } from "./useContextWindow.js";
import { formatTokenCount } from "./UsageWidget.js";

/** Props for {@link SummarizationCard}. */
export interface SummarizationCardProps {
  /** The summarization event to display. */
  readonly event: SummarizationEventView;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Inline timeline card shown when context summarization occurs mid-conversation.
 *
 * Renders as a compact system-event divider in the {@link MessageThread},
 * positioned chronologically between messages based on the event timestamp.
 *
 * Shows:
 * - "Context compacted" header with compression icon
 * - Token reduction (before -> after) and compression percentage
 * - Duration, model, and cost when available (native harness)
 * - For Cursor harness (model/duration unavailable): "Detected context compaction"
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @see {@link useContextWindow} - data source for summarization events
 * @see {@link SummarizationBadge} - sidebar aggregate widget (complementary)
 */
export const SummarizationCard = memo(function SummarizationCard({
  event,
  className,
}: SummarizationCardProps) {
  const reduction = Math.round(event.compressionRatio * 100);
  const isInferred = !event.model;

  return (
    <div
      role="status"
      aria-label="Context compacted"
      className={cn(
        "stg:mx-4 stg:flex stg:items-center stg:gap-3 stg:rounded-md stg:border stg:border-border/50",
        "stg:bg-muted/30 stg:px-3 stg:py-2",
        className,
      )}
    >
      <CompactionIcon />
      <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col stg:gap-0.5">
        <div className="stg:flex stg:items-baseline stg:gap-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
          <span>{isInferred ? "Detected context compaction" : "Context compacted"}</span>
          {event.timestamp && (
            <time dateTime={event.timestamp} className="stg:ml-auto stg:tabular-nums stg:text-muted-foreground/70">
              {formatTime(event.timestamp)}
            </time>
          )}
        </div>
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:text-xs stg:tabular-nums stg:text-muted-foreground/80">
          <span>
            {formatTokenCount(event.tokensBefore)} &rarr; {formatTokenCount(event.tokensAfter)} tokens
          </span>
          <span className="stg:text-muted-foreground/50">&middot;</span>
          <span>{reduction}% reduction</span>
          {event.durationMs > 0 && (
            <>
              <span className="stg:text-muted-foreground/50">&middot;</span>
              <span>{formatDuration(event.durationMs)}</span>
            </>
          )}
          {event.model && (
            <>
              <span className="stg:text-muted-foreground/50">&middot;</span>
              <span>{event.model}</span>
            </>
          )}
          {event.costUsd > 0 && (
            <>
              <span className="stg:text-muted-foreground/50">&middot;</span>
              <span>
                ${event.costUsd < 0.01 ? event.costUsd.toFixed(4) : event.costUsd.toFixed(2)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
      className="stg:shrink-0 stg:text-muted-foreground/70"
      aria-hidden="true"
    >
      <path d="M4 2v4l4-2-4-2zM12 14v-4l-4 2 4 2z" />
      <path d="M4 8h8" />
    </svg>
  );
}
