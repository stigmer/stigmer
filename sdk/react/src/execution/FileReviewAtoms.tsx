"use client";

import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";

/**
 * Shared presentational atoms for the file-review surfaces — the single source
 * for the `+N −M` stat and the change-kind marker, so the review card, the
 * compact list, and the mid-run progress bar can never drift in how they render
 * a file's magnitude or kind.
 */

/**
 * The `+N −M` stat for one file (or a whole set), in the same visual vocabulary
 * as the tool-row diff stats. Renders nothing when both counts are zero — the
 * honest signal that no count exists (binary or secret-withheld changes, records
 * captured before counts were stamped) — rather than a misleading `+0 −0`.
 */
export function FileLineStats({
  linesAdded,
  linesRemoved,
}: {
  readonly linesAdded: number;
  readonly linesRemoved: number;
}) {
  if (linesAdded === 0 && linesRemoved === 0) return null;
  return (
    <span
      className="stg:shrink-0 stg:text-xs stg:tabular-nums"
      aria-label={`${linesAdded} added, ${linesRemoved} removed`}
      data-cursor-target="file-review-line-stats"
    >
      <span className="stg:text-diff-added-fg">+{linesAdded}</span>{" "}
      <span className="stg:text-diff-removed-fg">-{linesRemoved}</span>
    </span>
  );
}

/** The kind letter, tone, and a11y name for each wire {@link FileChangeKind}. */
const KIND_BADGE: Partial<
  Record<FileChangeKind, { letter: string; colorClass: string; label: string }>
> = {
  [FileChangeKind.ADD]: {
    letter: "A",
    colorClass: "stg:text-diff-added-fg",
    label: "added",
  },
  [FileChangeKind.MODIFY]: {
    letter: "M",
    colorClass: "stg:text-diff-hunk-header-fg",
    label: "modified",
  },
  [FileChangeKind.DELETE]: {
    letter: "D",
    colorClass: "stg:text-diff-removed-fg",
    label: "deleted",
  },
  [FileChangeKind.RENAME]: {
    letter: "R",
    colorClass: "stg:text-diff-hunk-header-fg",
    label: "renamed",
  },
  // A binary change is a modification whose diff is not text; the letter stays
  // M and the binary-ness is told by the row's "Keep anyway" + reason note.
  [FileChangeKind.BINARY_CHANGE]: {
    letter: "M",
    colorClass: "stg:text-diff-hunk-header-fg",
    label: "modified (binary)",
  },
};

/**
 * The single-letter change-kind marker — the same M/A/D visual vocabulary as
 * the version-history `DiffFileList`, extended with R for captured renames.
 * The letter itself is the non-color channel; the full word is exposed to
 * assistive tech. An UNSPECIFIED kind renders nothing rather than guessing.
 */
export function FileKindBadge({ kind }: { kind: FileChangeKind }) {
  const badge = KIND_BADGE[kind];
  if (!badge) return null;
  return (
    <span
      className={cn("stg:shrink-0 stg:font-mono stg:text-[10px] stg:font-bold", badge.colorClass)}
      aria-label={badge.label}
    >
      {badge.letter}
    </span>
  );
}
