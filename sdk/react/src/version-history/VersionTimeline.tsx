"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { VersionTimelineProps } from "./types.js";
import { VersionTimelineEntry } from "./VersionTimelineEntry.js";

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

  const cancelCompare = useCallback(() => {
    setCompareSelection(null);
  }, []);

  if (isLoading) {
    return <TimelineSkeleton className={className} />;
  }

  if (entries.length === 0) {
    return <EmptyState message={emptyMessage} className={className} />;
  }

  const compareLabel = compareSelection
    ? entries.find((e) => e.id === compareSelection)?.label ?? compareSelection.slice(0, 12)
    : null;

  return (
    <div className={cn("stg:flex stg:flex-col stg:pt-2", className)}>
      {compareSelection && (
        <CompareInfoBar
          selectedLabel={compareLabel!}
          onCancel={cancelCompare}
        />
      )}

      <div role="list" aria-label="Version history">
        {entries.map((entry, index) => (
          <VersionTimelineEntry
            key={entry.id}
            entry={entry}
            isSelected={entry.id === selectedId}
            isCompareSource={entry.id === compareSelection}
            isLast={index === entries.length - 1}
            onSelect={() => handleSelect(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare-mode info bar
// ---------------------------------------------------------------------------

function CompareInfoBar({
  selectedLabel,
  onCancel,
}: {
  readonly selectedLabel: string;
  readonly onCancel: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="stg:mb-3 stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:border-dashed stg:border-primary stg:bg-primary-subtle stg:px-3 stg:py-2 stg:text-xs"
    >
      <CompareIcon className="stg:size-3.5 stg:shrink-0 stg:text-primary" />
      <span className="stg:flex-1 stg:text-foreground">
        Select another version to compare with{" "}
        <code className="stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:font-mono stg:text-[10px] stg:font-medium">
          {selectedLabel}
        </code>
      </span>
      <button
        type="button"
        onClick={onCancel}
        className={cn(
          "stg:rounded stg:px-2 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground stg:transition-colors",
          "stg:hover:bg-accent-hover stg:hover:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      >
        Cancel
      </button>
    </div>
  );
}

function CompareIcon({ className }: { readonly className?: string }) {
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
      <path d="M5 12V4M5 4l-3 3M11 4v8M11 12l3-3" />
    </svg>
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
      aria-label="Loading version history"
    >
      {[1, 2, 3].map((i) => (
        <div key={i} className="stg:flex stg:gap-3">
          <div className="stg:flex stg:flex-col stg:items-center">
            <div className="stg:size-2.5 stg:animate-pulse stg:rounded-full stg:bg-muted" />
            {i < 3 && <div className="stg:mt-1 stg:w-px stg:flex-1 stg:bg-border" />}
          </div>
          <div className="stg:mb-4 stg:flex-1 stg:space-y-2 stg:px-2.5 stg:py-2">
            <div className="stg:flex stg:gap-2">
              <div className="stg:h-4 stg:w-20 stg:animate-pulse stg:rounded stg:bg-muted" />
              <div className="stg:h-4 stg:w-12 stg:animate-pulse stg:rounded-full stg:bg-muted" />
            </div>
            <div className="stg:h-3 stg:w-32 stg:animate-pulse stg:rounded stg:bg-muted" />
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
        "stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-8 stg:text-center",
        className,
      )}
    >
      <HistoryIcon className="stg:size-8 stg:text-muted-foreground-faint" />
      <p className="stg:text-sm stg:text-muted-foreground">{message}</p>
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
