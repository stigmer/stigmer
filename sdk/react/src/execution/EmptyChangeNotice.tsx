"use client";

import { cn } from "@stigmer/theme";

/**
 * Which empty file-change state to describe.
 *
 * - `"empty-create"` — a new file proven to have no content (the approval gate's
 *   proto `FileChange` carries `changeType === CREATE` with an empty body).
 * - `"create"` — a new file IS being written, but its proposed content could not
 *   be captured for preview (the rare content-less FILE_WRITE gate, e.g. a
 *   no-stream denial synthesis). Distinguished from `empty-create` because the
 *   file is not proven empty — only proven to be a write/create.
 * - `"no-preview"` — the change carries no renderable diff/content AND cannot be
 *   proven to be a create (e.g. a path-only resume placeholder for an edit).
 *   Never claims emptiness or creation it cannot prove.
 */
export type EmptyChangeKind = "empty-create" | "create" | "no-preview";

const MESSAGE: Record<EmptyChangeKind, string> = {
  "empty-create": "New empty file",
  create: "New file — preview unavailable",
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
        "stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground",
        className,
      )}
    >
      {MESSAGE[kind]}
    </div>
  );
}
