"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowVersions } from "./useWorkflowVersions.js";
import { WorkflowVersionBadge } from "./WorkflowVersionBadge.js";
import type { VersionEntry } from "../version-history/types.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";

/** Props for {@link WorkflowVersionTimeline}. */
export interface WorkflowVersionTimelineProps {
  /** Workflow resource ID (used for keying, not fetching). */
  readonly workflowId: string;
  /** Organization slug for fetching versions. */
  readonly org: string;
  /** Workflow slug for fetching versions. */
  readonly slug: string;
  /** Called when the user selects a version entry. */
  readonly onSelectVersion?: (hash: string) => void;
  /** Currently selected version hash (controlled selection). */
  readonly selectedHash?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

const PAGE_SIZE = 20;

/**
 * Vertical timeline showing version history for a workflow.
 *
 * Internally fetches versions via `useWorkflowVersions(org, slug)` and
 * renders each entry with a `WorkflowVersionBadge`, actor name, relative
 * timestamp, and commit message. Supports selection highlighting and
 * client-side pagination via "Load more".
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <WorkflowVersionTimeline
 *   workflowId="wf_123"
 *   org="acme"
 *   slug="deploy-pipeline"
 *   onSelectVersion={(hash) => setSelected(hash)}
 *   selectedHash={selected}
 * />
 * ```
 */
export function WorkflowVersionTimeline({
  workflowId: _workflowId,
  org,
  slug,
  onSelectVersion,
  selectedHash,
  className,
}: WorkflowVersionTimelineProps) {
  const { versions, isLoading, isEmpty } = useWorkflowVersions(org, slug);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const handleLoadMore = useCallback(() => {
    setVisibleCount((c) => c + PAGE_SIZE);
  }, []);

  if (isLoading) {
    return <TimelineSkeleton className={className} />;
  }

  if (isEmpty) {
    return <EmptyState className={className} />;
  }

  const visibleVersions = versions.slice(0, visibleCount);
  const hasMore = versions.length > visibleCount;

  return (
    <div className={cn("stg:flex stg:flex-col stg:pt-2", className)}>
      <div role="list" aria-label="Workflow version history">
        {visibleVersions.map((entry, index) => (
          <VersionTimelineRow
            key={entry.id}
            entry={entry}
            isSelected={entry.id === selectedHash}
            isLast={index === visibleVersions.length - 1 && !hasMore}
            onSelect={() => onSelectVersion?.(entry.id)}
          />
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          className={cn(
            "stg:mt-2 stg:self-center stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-primary stg:transition-colors",
            "stg:hover:bg-primary-subtle",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          Load more ({versions.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline row
// ---------------------------------------------------------------------------

function VersionTimelineRow({
  entry,
  isSelected,
  isLast,
  onSelect,
}: {
  readonly entry: VersionEntry;
  readonly isSelected: boolean;
  readonly isLast: boolean;
  readonly onSelect: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div role="listitem" className="stg:relative stg:flex stg:gap-3">
      {/* Timeline connector */}
      <div className="stg:flex stg:flex-col stg:items-center stg:pt-1">
        <div
          className={cn(
            "stg:size-2.5 stg:shrink-0 stg:rounded-full stg:border-2",
            entry.isCurrent
              ? "stg:border-primary stg:bg-primary"
              : isSelected
                ? "stg:border-primary stg:bg-background"
                : "stg:border-border stg:bg-background",
          )}
          aria-hidden="true"
        />
        {!isLast && (
          <div className="stg:mt-1 stg:w-px stg:flex-1 stg:bg-border" aria-hidden="true" />
        )}
      </div>

      {/* Entry content */}
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-selected={isSelected}
        className={cn(
          "stg:mb-4 stg:flex stg:min-w-0 stg:flex-1 stg:flex-col stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-2 stg:text-left stg:transition-colors",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          isSelected ? "stg:bg-accent-hover" : "stg:hover:bg-accent-hover",
        )}
      >
        {/* Top line: version badge */}
        <div className="stg:flex stg:items-center stg:gap-2">
          <WorkflowVersionBadge
            versionHash={entry.id}
            tag={entry.tag}
            isCurrent={entry.isCurrent}
          />
        </div>

        {/* Second line: timestamp + actor */}
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-muted-foreground">
          <Tooltip>
            <TooltipTrigger render={<time dateTime={entry.timestamp.toISOString()} />}>
              {formatRelativeTime(entry.timestamp)}
            </TooltipTrigger>
            <TooltipContent side="top">{entry.timestamp.toLocaleString()}</TooltipContent>
          </Tooltip>

          {entry.actor && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span className="stg:flex stg:items-center stg:gap-1">
                {entry.actor.avatar && (
                  <img
                    src={entry.actor.avatar}
                    alt=""
                    className="stg:size-3.5 stg:rounded-full"
                  />
                )}
                <span>{entry.actor.displayName || entry.actor.id}</span>
              </span>
            </>
          )}
        </div>

        {/* Commit message */}
        {entry.sublabel && (
          <p className="stg:text-xs stg:text-muted-foreground">{entry.sublabel}</p>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function TimelineSkeleton({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn("stg:flex stg:flex-col stg:gap-4 stg:pt-2", className)}
      aria-busy="true"
      aria-label="Loading workflow version history"
    >
      {[1, 2, 3].map((i) => (
        <div key={i} className="stg:flex stg:gap-3">
          <div className="stg:flex stg:flex-col stg:items-center">
            <div className="stg:size-2.5 stg:animate-pulse stg:rounded-full stg:bg-muted" />
            {i < 3 && <div className="stg:mt-1 stg:w-px stg:flex-1 stg:bg-border" />}
          </div>
          <div className="stg:mb-4 stg:flex-1 stg:space-y-2 stg:px-2.5 stg:py-2">
            <div className="stg:flex stg:gap-2">
              <div className="stg:h-4 stg:w-16 stg:animate-pulse stg:rounded stg:bg-muted" />
              <div className="stg:h-4 stg:w-10 stg:animate-pulse stg:rounded-full stg:bg-muted" />
            </div>
            <div className="stg:h-3 stg:w-28 stg:animate-pulse stg:rounded stg:bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ className }: { readonly className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-8 stg:text-center",
        className,
      )}
    >
      <HistoryIcon className="stg:size-8 stg:text-muted-foreground-faint" />
      <p className="stg:text-sm stg:text-muted-foreground">
        No version history available
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function HistoryIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 4v4l2.5 1.5" />
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8a6 6 0 0 1 6-6" />
    </svg>
  );
}
