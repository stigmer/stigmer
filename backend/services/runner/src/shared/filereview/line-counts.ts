/**
 * Capture-time line counting for the file-review subsystem: the `+N −M` stamped
 * onto each {@link CapturedFileChange} so review surfaces can decorate file
 * lists without the file bodies.
 *
 * WHY THE RUNNER COUNTS, AND WHY WITH JSDIFF. The counts exist because the
 * review UI's compact file lists must show per-file magnitude, but by the time
 * the UI renders, large before/after bodies may have been offloaded to artifact
 * storage (status-offload) — a client cannot count what it would first have to
 * download. So the counts are computed once, at capture, where the bytes are
 * always in hand. They are computed with the SAME `diff` (jsdiff) Myers
 * algorithm the SDK's diff renderer uses (`computeDiff` → `structuredPatch`),
 * NOT with `git diff --numstat`: two counting authorities can disagree on edge
 * cases (trailing newlines being the classic), and a list that says `+37 −1`
 * beside a rendered diff showing `+37 −0` is a self-contradicting UI. One
 * algorithm, consistent by construction.
 *
 * The counts are INFORMATIONAL display data only — never an enforcement input,
 * never folded into `file_digest`/`aggregate_digest` (the same contract as
 * `blocked_reason`).
 */

import { structuredPatch } from "diff";

/**
 * Per-side byte ceiling above which counting is skipped. Myers is O(ND) and a
 * pathological many-MB text pair must never stall the capture activity just to
 * decorate a list; above this the counts stay absent and the UI hides the stat.
 * Generous relative to the 128 KiB per-side inline-persist cap — a file can be
 * several times that and still count quickly — while bounding the worst case.
 */
export const LINE_COUNT_MAX_BYTES = 1024 * 1024;

/** The `+N −M` pair for one file change. */
export interface LineChangeCounts {
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

/**
 * Count the added/removed lines between two text sides, exactly as the SDK's
 * diff renderer would show them.
 *
 * An absent side is the empty document — an ADD counts every `after` line as
 * added, a DELETE every `before` line as removed — mirroring how the renderer
 * diffs a create/delete. `\ No newline at end of file` markers are metadata,
 * not content, and are excluded (the same rule as the SDK's `mapPatchHunks`).
 *
 * Returns `undefined` when counting is not possible or meaningful: both sides
 * absent, or either side over {@link LINE_COUNT_MAX_BYTES}. Callers leave the
 * proto counts at zero in that case, which consumers render as "no stat".
 */
export function countLineChanges(
  before: string | undefined,
  after: string | undefined,
): LineChangeCounts | undefined {
  if (before === undefined && after === undefined) return undefined;
  const beforeText = before ?? "";
  const afterText = after ?? "";
  if (
    Buffer.byteLength(beforeText, "utf8") > LINE_COUNT_MAX_BYTES ||
    Buffer.byteLength(afterText, "utf8") > LINE_COUNT_MAX_BYTES
  ) {
    return undefined;
  }

  // Zero context: the +/- line population is independent of context width, and
  // omitting context lines keeps the walk (and the patch object) minimal.
  const patch = structuredPatch("a", "b", beforeText, afterText, "", "", {
    context: 0,
  });

  let linesAdded = 0;
  let linesRemoved = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) continue;
      if (line[0] === "+") linesAdded++;
      else if (line[0] === "-") linesRemoved++;
    }
  }
  return { linesAdded, linesRemoved };
}
