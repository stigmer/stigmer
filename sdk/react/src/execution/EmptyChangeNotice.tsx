"use client";

import { cn } from "@stigmer/theme";

/**
 * Which empty file-change state to describe.
 *
 * - `"empty-create"` — a new file with no content. Truthful only where the
 *   change type is authoritative (the approval gate's proto `FileChange`).
 * - `"no-preview"` — the change carries no renderable diff/content (e.g. a
 *   resume placeholder gate that knows only the path). Never claims emptiness it
 *   cannot prove.
 */
export type EmptyChangeKind = "empty-create" | "no-preview";

const MESSAGE: Record<EmptyChangeKind, string> = {
  "empty-create": "New empty file",
  "no-preview": "No preview available for this change",
};

/** Props for {@link EmptyChangeNotice}. */
export interface EmptyChangeNoticeProps {
  /** The empty-change state to describe. */
  readonly kind: EmptyChangeKind;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * A quiet, neutral notice rendered in place of a diff when a file change has
 * nothing to show — a newly created empty file, or a change whose content is
 * genuinely unavailable.
 *
 * It is the single owner of both messages so the approval gate and the
 * post-execution detail can never drift apart in wording. The two cases are
 * deliberately distinct: an honest "new empty file" requires proof (the gate's
 * proto change type), while everything else degrades to the non-committal
 * "no preview available" rather than misrepresenting an uncaptured change as
 * empty.
 *
 * Styled to match the `Notice` used elsewhere in the change views (neutral
 * border + muted surface, tokens only — DD-005).
 */
export function EmptyChangeNotice({ kind, className }: EmptyChangeNoticeProps) {
  return (
    <div
      role="status"
      data-cursor-target="empty-change-notice"
      className={cn(
        "rounded-md border border-border bg-muted-subtle px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      {MESSAGE[kind]}
    </div>
  );
}
