// Pure helpers the terminal's file-review surfaces share: the change-kind
// letter, the rename-aware path rule, a file's block reason, a set's line
// stats and its settled outcome. A turn's review — its files and how each
// was decided — is the session's fold (`FileReviewSet`); the mid-run
// progress strip reads the run's slim progress entries.
import type { FileChangeProgressEntry } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { extractPrimaryArg, fileReviewability } from "@stigmer/react-core";
import { resolveToolKind, type FileReviewFile, type FileReviewSet, type ToolUse } from "@stigmer/client";

/**
 * Single-letter badge for a file change's kind, matching the web review card:
 * `A` added, `M` modified, `D` deleted, `R` renamed. A binary change reads as
 * `M` — "binary" is a review-completeness property (`fileReviewability`), not
 * a distinct edit kind.
 */
export function kindLetter(kind: FileChangeKind): string {
  switch (kind) {
    case FileChangeKind.ADD:
      return "A";
    case FileChangeKind.DELETE:
      return "D";
    case FileChangeKind.RENAME:
      return "R";
    default:
      return "M";
  }
}

/**
 * The one rename-aware path-display rule for the terminal, fed by the typed
 * adapters below so the review and progress surfaces can never grow divergent
 * rename formatting.
 */
function displayChangePath(previousPath: string, path: string, renamed: boolean): string {
  if (renamed && previousPath && path) {
    return `${previousPath} → ${path}`;
  }
  return path || previousPath;
}

/**
 * The path to show for a file of a turn's review. A rename shows
 * `before → after` so both sides are visible.
 */
export function fileDisplayPath(file: Pick<FileReviewFile, "path" | "previousPath" | "change">): string {
  return displayChangePath(file.previousPath, file.path, file.change === "renamed");
}

/**
 * The path to show for a mid-run progress entry, using the same rename-aware
 * rule as {@link fileDisplayPath}: the post-edit path, or the pre-edit path
 * for a deletion.
 */
export function progressEntryDisplayPath(entry: FileChangeProgressEntry): string {
  return displayChangePath(entry.pathBefore, entry.pathAfter, entry.kind === FileChangeKind.RENAME);
}

/**
 * The honest, one-line reason a file cannot be kept as-is, or `null` when it
 * is fully reviewable. Mirrors the web card's per-file block-reason copy so
 * the terminal reviewer sees the same explanation.
 */
export function blockReasonNote(file: Pick<FileReviewFile, "reviewable">): string | null {
  const reviewability = fileReviewability(file);
  switch (reviewability.kind) {
    case "reviewable":
      return null;
    case "binary":
      return "binary — no text diff; keep as-is or discard";
    case "unavailable":
      return reviewability.reason === "secret"
        ? "contents withheld (looks like a secret) — discard only"
        : "diff unavailable — discard only";
  }
}

/** The aggregate `+N −M` line counts for a set. */
export interface LineStats {
  /** Total lines added across the set's files. */
  readonly linesAdded: number;
  /** Total lines removed across the set's files. */
  readonly linesRemoved: number;
}

/**
 * Sums a set's per-file `linesAdded`/`linesRemoved` into one aggregate, for
 * the set-level `+N −M` beside the prompt header and the settled record
 * summary. Counts every file regardless of verdict — it reports what
 * changed, not what was kept. A file with no counts (binary,
 * secret-withheld) contributes zero, so the aggregate honestly understates
 * rather than guessing.
 */
export function changeSetLineStats(set: Pick<FileReviewSet, "files">): LineStats {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const file of set.files) {
    linesAdded += file.linesAdded;
    linesRemoved += file.linesRemoved;
  }
  return { linesAdded, linesRemoved };
}

/** The per-file outcome counts for a settled set. */
export interface SettledCounts {
  /** Files kept. */
  readonly kept: number;
  /** Files undone (put back, or being put back). */
  readonly discarded: number;
  /** Files whose undo failed. */
  readonly failed: number;
  /** Files never decided. */
  readonly notReviewed: number;
}

/** Folds a set's file states into kept / discarded / failed / not-reviewed counts. */
export function settledCounts(set: Pick<FileReviewSet, "files">): SettledCounts {
  let kept = 0;
  let discarded = 0;
  let failed = 0;
  for (const file of set.files) {
    if (file.state === "kept") kept++;
    else if (file.state === "undone" || file.state === "undoing") discarded++;
    else if (file.state === "undo_failed") failed++;
  }
  return { kept, discarded, failed, notReviewed: set.files.length - kept - discarded - failed };
}

/**
 * A one-line summary of a settled set's outcome, e.g. `2 kept · 1
 * discarded`, or `3 files changed` when nothing was decided.
 */
export function settledSummary(set: Pick<FileReviewSet, "files">): string {
  const { kept, discarded, failed, notReviewed } = settledCounts(set);
  const n = set.files.length;
  if (notReviewed === n) return `${n} file${n === 1 ? "" : "s"} changed`;
  const parts: string[] = [];
  if (kept) parts.push(`${kept} kept`);
  if (discarded) parts.push(`${discarded} discarded`);
  if (failed) parts.push(`${failed} could not be put back`);
  if (notReviewed) parts.push(`${notReviewed} not reviewed`);
  return parts.join(" · ");
}

/**
 * The file a tool use edited, when it is a file write, edit or delete: the
 * path its file-review badge is matched by. `null` for any other tool.
 */
export function editedPath(toolUse: ToolUse): string | null {
  switch (resolveToolKind(toolUse)) {
    case "file_write":
    case "file_edit":
    case "file_delete":
      return extractPrimaryArg(toolUse);
    default:
      return null;
  }
}
