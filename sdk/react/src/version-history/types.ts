import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Generic version entry — presentation-layer type for the timeline component
// ---------------------------------------------------------------------------

/**
 * A single entry in a version timeline.
 *
 * This is a generic presentation type — not tied to any specific resource.
 * Resource-specific hooks (e.g., `useSkillVersions`) map from proto types
 * to this shape, enabling the `VersionTimeline` component to render version
 * history for any resource type.
 */
export interface VersionEntry {
  /** Unique identifier for this version (e.g., content hash). */
  readonly id: string;
  /** When this version was created/pushed. */
  readonly timestamp: Date;
  /** Actor who created this version. */
  readonly actor?: {
    readonly id: string;
    readonly avatar?: string;
    readonly displayName?: string;
  };
  /** Primary display text (e.g., truncated content hash). */
  readonly label: string;
  /** Secondary text (e.g., commit message or version description). */
  readonly sublabel?: string;
  /** Whether this is the currently active version. */
  readonly isCurrent?: boolean;
  /** Version tag (e.g., "stable", "v1.0"). */
  readonly tag?: string;
  /** Git provenance for traceability. */
  readonly gitProvenance?: {
    readonly remoteUrl: string;
    readonly ref: string;
    readonly commit: string;
  };
  /** Extensible key-value metadata for display. */
  readonly metadata?: Readonly<Record<string, string>>;
}

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
   * callback is provided — enabling T05-D integration.
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
  /** Whether this is the last entry in the timeline (no connecting line below). */
  readonly isLast?: boolean;
  /** Called when this entry is clicked. */
  readonly onSelect?: () => void;
  /** Optional trailing content (e.g., action buttons). */
  readonly trailing?: ReactNode;
}
