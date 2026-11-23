import type { ReactNode } from "react";
import type { DiffHunk, VersionEntry } from "@stigmer/react-core";

// ---------------------------------------------------------------------------
// Diff types — generic text diff primitives for any versioned resource
// ---------------------------------------------------------------------------

export type { DiffLine, DiffHunk } from "@stigmer/react-core";

/** Summary of changes to a single file between two versions. */
export interface FileDiffEntry {
  readonly path: string;
  readonly changeType: "added" | "removed" | "modified";
  readonly additions: number;
  readonly deletions: number;
}

/** Aggregated diff result across all files in two version snapshots. */
export interface MultiFileDiffResult {
  readonly files: readonly FileDiffEntry[];
  readonly totalAdditions: number;
  readonly totalDeletions: number;
  /** Retrieve the hunk-level diff for a specific file path. */
  readonly getDiff: (path: string) => readonly DiffHunk[];
}

/** Display mode for the diff viewer. */
export type DiffViewMode = "unified";

// ---------------------------------------------------------------------------
// Generic version entry — the timeline's entry, kept in @stigmer/react-core
// beside the version hooks that produce it
// ---------------------------------------------------------------------------

export type { VersionEntry } from "@stigmer/react-core";

// ---------------------------------------------------------------------------
// VersionTimeline props
// ---------------------------------------------------------------------------

/** Props for {@link VersionTimeline}. */
export interface VersionTimelineProps {
  /** Ordered list of version entries (newest first). */
  readonly entries: readonly VersionEntry[];
  /** Called when a single entry is selected (clicked). */
  readonly onEntrySelect?: (id: string) => void;
  /**
   * Called when two entries are selected for comparison.
   * The component manages compare-mode selection internally when this
   * callback is provided — enabling a diff viewer integration.
   */
  readonly onCompare?: (fromId: string, toId: string) => void;
  /** Currently selected entry ID (controlled selection). */
  readonly selectedId?: string;
  /** `true` while version data is being fetched. */
  readonly isLoading?: boolean;
  /** Message shown when `entries` is empty and not loading. */
  readonly emptyMessage?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// VersionTimelineEntry props
// ---------------------------------------------------------------------------

/** Props for {@link VersionTimelineEntry}. */
export interface VersionTimelineEntryProps {
  /** The version entry data to render. */
  readonly entry: VersionEntry;
  /** Whether this entry is currently selected. */
  readonly isSelected?: boolean;
  /** Whether this entry is the first pick in compare mode (dashed border, "A" badge). */
  readonly isCompareSource?: boolean;
  /** Whether this is the last entry in the timeline (no connecting line below). */
  readonly isLast?: boolean;
  /** Called when this entry is clicked. */
  readonly onSelect?: () => void;
  /** Optional trailing content (e.g., action buttons). */
  readonly trailing?: ReactNode;
}
