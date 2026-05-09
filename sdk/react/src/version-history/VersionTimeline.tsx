"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { VersionTimelineProps } from "./types";
import { VersionTimelineEntry } from "./VersionTimelineEntry";

/**
 * Accessible vertical timeline for version history.
 *
 * Renders a chronologically-ordered list of version entries with a
 * connecting line, selection state, and optional compare mode. Designed
 * as a generic SDK primitive usable for any versioned resource (skills,
 * and in future, agents, MCP servers).
 *
 * Supports two interaction modes:
 * - **Select mode** (default): single-click selects an entry, fires `onEntrySelect`
 * - **Compare mode** (when `onCompare` is provided): selecting two entries fires
 *   `onCompare(fromId, toId)` — designed for T05-D diff viewer integration
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const { versions } = useSkillVersions(org, slug);
 *
 * <VersionTimeline
 *   entries={versions}
 *   onEntrySelect={(id) => console.log("Selected:", id)}
 * />
 * ```
 */
export function VersionTimeline({
  entries,
  onEntrySelect,
  onCompare,
  selectedId,
  isLoading,
  emptyMessage = "No version history available",
  className,
}: VersionTimelineProps) {
  const [compareSelection, setCompareSelection] = useState<string | null>(null);

  const handleSelect = useCallback(
    (id: string) => {
      if (onCompare) {
        if (compareSelection === null) {
          setCompareSelection(id);
        } else if (compareSelection === id) {
          setCompareSelection(null);
        } else {
          onCompare(compareSelection, id);
          setCompareSelection(null);
        }
      }

      onEntrySelect?.(id);
    },
    [onCompare, onEntrySelect, compareSelection],
  );

  if (isLoading) {
    return <TimelineSkeleton className={className} />;
  }

  if (entries.length === 0) {
    return <EmptyState message={emptyMessage} className={className} />;
  }

  return (
    <div
      role="list"
      aria-label="Version history"
      className={cn("flex flex-col pt-2", className)}
    >
      {entries.map((entry, index) => (
        <VersionTimelineEntry
          key={entry.id}
          entry={entry}
          isSelected={
            entry.id === selectedId || entry.id === compareSelection
          }
          isLast={index === entries.length - 1}
          onSelect={() => handleSelect(entry.id)}
        />
      ))}
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
      aria-label="Loading version history"
    >
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="size-2.5 animate-pulse rounded-full bg-muted" />
            {i < 3 && <div className="mt-1 w-px flex-1 bg-border" />}
          </div>
          <div className="mb-4 flex-1 space-y-2 px-2.5 py-2">
            <div className="flex gap-2">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-4 w-12 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  message,
  className,
}: {
  readonly message: string;
  readonly className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-2 py-8 text-center",
        className,
      )}
    >
      <HistoryIcon className="size-8 text-muted-foreground-faint" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
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
