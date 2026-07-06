import type {
  CapturedFileChange,
  FileChangeProgressEntry,
  FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileChangeKind,
  FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { deriveEffectiveVerdicts, fileReviewability } from "@stigmer/react";

/**
 * Single-letter badge for a file change's kind, matching the web review card:
 * `A` added, `M` modified, `D` deleted, `R` renamed. A binary change reads as
 * `M` — "binary" is a review-completeness property (from `FileContent.is_binary`
 * via `fileReviewability`), not a distinct edit kind.
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
 * The one rename-aware path-display rule for the terminal, over the raw
 * before/after/kind triple shared by every file-change shape (reviewable
 * `CapturedFileChange` and slim `FileChangeProgressEntry` alike). Kept private
 * and fed by the typed adapters below so the two surfaces can never grow
 * divergent rename formatting.
 */
function displayChangePath(
  pathBefore: string,
  pathAfter: string,
  kind: FileChangeKind,
): string {
  if (kind === FileChangeKind.RENAME && pathBefore && pathAfter) {
    return `${pathBefore} → ${pathAfter}`;
  }
  return pathAfter || pathBefore;
}

/**
 * The path to show for a reviewable change: the post-edit path, or the pre-edit
 * path for a deletion. A rename shows `before → after` so both sides are visible.
 */
export function changeDisplayPath(change: CapturedFileChange): string {
  return displayChangePath(change.pathBefore, change.pathAfter, change.kind);
}

/**
 * The path to show for a mid-run progress entry (DD-32), using the same
 * rename-aware rule as {@link changeDisplayPath}. The slim entry carries no
 * bodies or digests, only the same before/after/kind triple, so the terminal
 * renders its path identically to the reviewable surfaces.
 */
export function progressEntryDisplayPath(entry: FileChangeProgressEntry): string {
  return displayChangePath(entry.pathBefore, entry.pathAfter, entry.kind);
}

/**
 * The honest, one-line reason a change cannot be kept as-is, or `null` when it
 * is fully reviewable. Mirrors the web card's per-file block-reason copy so the
 * terminal reviewer sees the same explanation.
 */
export function blockReasonNote(change: CapturedFileChange): string | null {
  const reviewability = fileReviewability(change);
  switch (reviewability.kind) {
    case "reviewable":
      return null;
    case "binary":
      return "binary — no text diff; keep as-is or discard";
    case "unavailable":
      switch (reviewability.reason) {
        case "secret":
          return "contents withheld (looks like a secret) — discard only";
        case "size":
          return "diff too large to display — discard only";
        default:
          return "diff unavailable — discard only";
      }
  }
}

/** The aggregate `+N −M` line counts for a change set. */
export interface LineStats {
  /** Total lines added across the set's changes. */
  readonly linesAdded: number;
  /** Total lines removed across the set's changes. */
  readonly linesRemoved: number;
}

/**
 * Sums a change set's per-file `linesAdded`/`linesRemoved` into one aggregate,
 * for the set-level `+N −M` shown beside the prompt header and the settled
 * record summary (parity with the web card's collapsed-bar aggregate). Counts
 * every change regardless of verdict — it reports what changed, not what was
 * kept. A file with no counts (binary, secret-withheld, or a record predating
 * the fields) contributes zero, so the aggregate honestly understates rather
 * than guessing; when NO file has counts it is zero and the stat is hidden.
 */
export function changeSetLineStats(set: FileChangeSet): LineStats {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const change of set.changes) {
    linesAdded += change.linesAdded;
    linesRemoved += change.linesRemoved;
  }
  return { linesAdded, linesRemoved };
}

/** The effective per-file verdict counts for a settled change set. */
export interface SettledCounts {
  /** Files kept (effective verdict APPROVE). */
  readonly kept: number;
  /** Files discarded (effective verdict REJECT). */
  readonly discarded: number;
  /** Files with no effective verdict (neither kept nor discarded). */
  readonly notReviewed: number;
}

/**
 * Folds a settled change set's decisions into kept / discarded / not-reviewed
 * counts, using the same `deriveEffectiveVerdicts` fold the web uses so a
 * "Keep all" set correctly reads every file as kept.
 */
export function settledCounts(set: FileChangeSet): SettledCounts {
  const verdicts = deriveEffectiveVerdicts(set);
  let kept = 0;
  let discarded = 0;
  for (const change of set.changes) {
    const verdict = verdicts.get(change.id);
    if (verdict === FileDecisionAction.APPROVE) kept++;
    else if (verdict === FileDecisionAction.REJECT) discarded++;
  }
  return {
    kept,
    discarded,
    notReviewed: set.changes.length - kept - discarded,
  };
}

/**
 * A one-line summary of a settled change set's outcome, e.g. `2 kept · 1
 * discarded`, or `3 files changed` when nothing was individually decided.
 */
export function settledSummary(set: FileChangeSet): string {
  const { kept, discarded, notReviewed } = settledCounts(set);
  const parts: string[] = [];
  if (kept) parts.push(`${kept} kept`);
  if (discarded) parts.push(`${discarded} discarded`);
  if (notReviewed) parts.push(`${notReviewed} not reviewed`);
  if (parts.length > 0) return parts.join(" · ");
  const n = set.changes.length;
  return `${n} file${n === 1 ? "" : "s"} changed`;
}
