import type { ReactNode } from "react";

/**
 * Semantic variant for an empty state, each representing a distinct
 * reason why no content is visible.
 */
export type EmptyStateVariant =
  | "first-use"
  | "zero-results"
  | "permission"
  | "error";

/** Action rendered as a button within the empty state. */
export interface EmptyStateAction {
  /** Button label. */
  readonly label: string;
  /** Click handler. */
  readonly onClick: () => void;
}

/** Options for the {@link useEmptyState} behavior hook. */
export interface UseEmptyStateOptions {
  /** The semantic reason no content is shown. */
  readonly variant: EmptyStateVariant;
  /**
   * Human-readable label for the resource type (e.g. "agents", "skills").
   * Used to generate contextual default copy.
   */
  readonly resourceLabel?: string;
  /** Custom title override. When provided, replaces the generated default. */
  readonly title?: string;
  /** Custom description override. When provided, replaces the generated default. */
  readonly description?: string;
  /** Error message to display — relevant for the "error" variant. */
  readonly errorMessage?: string;
}

/** Return value of the {@link useEmptyState} behavior hook. */
export interface UseEmptyStateReturn {
  /** Resolved title text. */
  readonly title: string;
  /** Resolved description text. */
  readonly description: string;
  /** Suggested default icon for the variant (as a ReactNode). */
  readonly defaultIcon: ReactNode;
  /** The ARIA role appropriate for this variant. */
  readonly role: "status" | "alert";
}

/** Props for the styled {@link EmptyState} component. */
export interface EmptyStateProps {
  /**
   * The semantic reason no content is shown.
   * Determines default icon, copy, and ARIA role.
   */
  readonly variant: EmptyStateVariant;
  /**
   * Human-readable label for the resource type (e.g. "agents", "skills").
   * Used to generate contextual default copy.
   */
  readonly resourceLabel?: string;
  /** Custom icon to display. Defaults to a variant-appropriate Lucide icon. */
  readonly icon?: ReactNode;
  /** Custom title override. */
  readonly title?: string;
  /** Custom description override. */
  readonly description?: string;
  /** Error message — only used when variant is "error". */
  readonly errorMessage?: string;
  /** Primary action button. */
  readonly action?: EmptyStateAction;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}
