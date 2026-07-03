"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowVersions } from "./useWorkflowVersions.js";
import { WorkflowVersionBadge } from "./WorkflowVersionBadge.js";
import type { VersionEntry } from "../version-history/types.js";

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
    <div className={cn("flex flex-col pt-2", className)}>
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
            "mt-2 self-center rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors",
            "hover:bg-primary-subtle",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
    <div role="listitem" className="relative flex gap-3">
      {/* Timeline connector */}
      <div className="flex flex-col items-center pt-1">
        <div
          className={cn(
            "size-2.5 shrink-0 rounded-full border-2",
            entry.isCurrent
              ? "border-primary bg-primary"
              : isSelected
                ? "border-primary bg-background"
                : "border-border bg-background",
          )}
          aria-hidden="true"
        />
        {!isLast && (
          <div className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
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
          "mb-4 flex min-w-0 flex-1 flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSelected ? "bg-accent-hover" : "hover:bg-accent-hover",
        )}
      >
        {/* Top line: version badge */}
        <div className="flex items-center gap-2">
          <WorkflowVersionBadge
            versionHash={entry.id}
            tag={entry.tag}
            isCurrent={entry.isCurrent}
          />
        </div>

        {/* Second line: timestamp + actor */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <time
            dateTime={entry.timestamp.toISOString()}
            title={entry.timestamp.toLocaleString()}
          >
            {formatRelativeTime(entry.timestamp)}
          </time>

          {entry.actor && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span className="flex items-center gap-1">
                {entry.actor.avatar && (
                  <img
                    src={entry.actor.avatar}
                    alt=""
                    className="size-3.5 rounded-full"
                  />
                )}
                <span>{entry.actor.displayName || entry.actor.id}</span>
              </span>
            </>
          )}
        </div>

        {/* Commit message */}
        {entry.sublabel && (
          <p className="text-xs text-muted-foreground">{entry.sublabel}</p>
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
      className={cn("flex flex-col gap-4 pt-2", className)}
      aria-busy="true"
      aria-label="Loading workflow version history"
    >
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="size-2.5 animate-pulse rounded-full bg-muted" />
            {i < 3 && <div className="mt-1 w-px flex-1 bg-border" />}
          </div>
          <div className="mb-4 flex-1 space-y-2 px-2.5 py-2">
            <div className="flex gap-2">
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              <div className="h-4 w-10 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-3 w-28 animate-pulse rounded bg-muted" />
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
        "flex flex-col items-center gap-2 py-8 text-center",
        className,
      )}
    >
      <HistoryIcon className="size-8 text-muted-foreground-faint" />
      <p className="text-sm text-muted-foreground">
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
