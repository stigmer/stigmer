"use client";

import { memo, useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { SummarizationEventView } from "./useContextWindow.js";
import { formatTokenCount } from "./UsageWidget.js";

/** Props for {@link SummarizationBadge}. */
export interface SummarizationBadgeProps {
  /** Summarization events ordered chronologically (oldest first). */
  readonly events: readonly SummarizationEventView[];
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Collapsible badge showing summarization event history for an execution.
 *
 * Collapsed state shows a count badge ("2 summarizations").
 * Expanded state lists each event with before/after token counts,
 * compression ratio, duration, and cost.
 *
 * Returns `null` when there are no events.
 *
 * All visual properties flow through `--stgm-*` tokens.
 * Accessible via `role="group"` and keyboard-expandable.
 *
 * @example
 * ```tsx
 * const ctx = useContextWindow(execution);
 * <SummarizationBadge events={ctx.summarizationEvents} />
 * ```
 *
 * @see {@link useContextWindow} - data source for summarization events
 */
export const SummarizationBadge = memo(function SummarizationBadge({
  events,
  className,
}: SummarizationBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  if (events.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Summarization history"
      className={cn("stg:flex stg:flex-col stg:gap-1", className)}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded stg:px-1.5 stg:py-0.5",
          "stg:text-xs stg:text-muted-foreground",
          "stg:hover:bg-muted/50 stg:transition-colors",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
        )}
      >
        <SummarizationIcon />
        <span className="stg:tabular-nums">
          {events.length}{" "}
          {events.length === 1 ? "summarization" : "summarizations"}
        </span>
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div
          role="list"
          aria-label="Summarization events"
          className="stg:flex stg:flex-col stg:gap-1 stg:pl-2"
        >
          {events.map((event, i) => (
            <EventRow key={event.timestamp || i} event={event} index={i} />
          ))}
        </div>
      )}
    </div>
  );
});

const EventRow = memo(function EventRow({
  event,
  index,
}: {
  readonly event: SummarizationEventView;
  readonly index: number;
}) {
  const reduction = Math.round(event.compressionRatio * 100);

  return (
    <div
      role="listitem"
      className="stg:flex stg:flex-col stg:gap-0.5 stg:rounded stg:border stg:border-border/50 stg:px-2 stg:py-1.5"
    >
      <div className="stg:flex stg:items-baseline stg:justify-between stg:text-xs stg:text-muted-foreground">
        <span className="stg:font-medium">#{index + 1}</span>
        {event.timestamp && (
          <time
            dateTime={event.timestamp}
            className="stg:tabular-nums"
          >
            {formatTime(event.timestamp)}
          </time>
        )}
      </div>
      <div className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        {formatTokenCount(event.tokensBefore)} →{" "}
        {formatTokenCount(event.tokensAfter)} tokens ({reduction}% reduction)
      </div>
      <div className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        {event.durationMs > 0 && <>{formatDurationMs(event.durationMs)}</>}
        {event.model && (
          <>
            {event.durationMs > 0 && " · "}
            {event.model}
          </>
        )}
        {event.costUsd > 0 && (
          <>
            {" · "}${event.costUsd < 0.01 ? event.costUsd.toFixed(4) : event.costUsd.toFixed(2)}
          </>
        )}
      </div>
    </div>
  );
});

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function SummarizationIcon() {
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
    >
      <path d="M2 3h8M2 6h5M2 9h3" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "stg:transition-transform",
        expanded && "stg:rotate-180",
      )}
    >
      <path d="M2.5 4L5 6.5L7.5 4" />
    </svg>
  );
}
