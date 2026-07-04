import type {
  CapturedFileChange,
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
 * The path to show for a change: the post-edit path, or the pre-edit path for a
 * deletion. A rename shows `before → after` so both sides are visible.
 */
export function changeDisplayPath(change: CapturedFileChange): string {
  if (change.kind === FileChangeKind.RENAME && change.pathBefore && change.pathAfter) {
    return `${change.pathBefore} → ${change.pathAfter}`;
  }
  return change.pathAfter || change.pathBefore;
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
