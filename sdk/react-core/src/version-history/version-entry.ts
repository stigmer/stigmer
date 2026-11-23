// One entry of a version history, in the shape every versioned resource
// shares (agents, skills, plugins): what a timeline draws for a version,
// with no component type, so a host drawing its own history reads it from
// this package alone. The React kit's `VersionTimeline` takes it as is.

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
