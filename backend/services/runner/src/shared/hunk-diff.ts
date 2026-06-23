/**
 * Synthesize a HUNK_ONLY unified diff from an edit's `old_string` /
 * `new_string`, shared by both harnesses' approval-gate capture.
 *
 * At the approval gate the tool has NOT run, so neither harness has an
 * authoritative diff: the native (deepagents) edit tools carry only the
 * `old_string`/`new_string` fragment in their args, and the Cursor SDK computes
 * its `diffString` only at the terminal result a denial never produces. Both
 * therefore synthesize the same honest representation of the proposed
 * replacement — the removed block then the added block — without locating it in
 * the file or reconstructing the whole-file result (which would make the runner
 * a second source of truth for the edit). The whole-file ground truth still
 * lands post-execution and overwrites this preview.
 *
 * Kept out of `file-change.ts` deliberately: that module documents that it does
 * NO diff computation (each harness supplies its own). This is that single
 * shared diff computation, so a future third surface reuses it rather than
 * forking a third `-old/+new` builder.
 *
 * @since First-Class Diff Review (#186), approval-gate phase
 */

import { INLINE_FILE_CONTENT_MAX_BYTES } from "./status-offload.js";

/**
 * Build a `-old / +new` hunk from an edit's replacement strings, with line
 * counts reflecting the true (pre-truncation) sizes.
 *
 * The output is byte-bounded to {@link INLINE_FILE_CONTENT_MAX_BYTES}: a
 * `unified_diff` is not offloaded body-by-body at persist (only `before`/`after`
 * are), so bounding it here keeps a large edit from carrying a multi-megabyte
 * inline diff into the recomputed `pending_approvals`. The aggregate persist
 * backstop only elides `unified_diff` past the much larger status cap, so the
 * local bound is what protects the projection.
 */
export function synthesizeHunkDiff(
  oldStr: string,
  newStr: string,
): { unifiedDiff: string; linesAdded: number; linesRemoved: number } {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  const body = [
    "@@ proposed edit @@",
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");

  return {
    unifiedDiff: boundToBytes(body, INLINE_FILE_CONTENT_MAX_BYTES),
    linesAdded: newLines.length,
    linesRemoved: oldLines.length,
  };
}

/** Truncate `s` to at most `maxBytes` UTF-8 bytes, appending a notice if cut. */
function boundToBytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;

  const marker = "\n[diff truncated — full change shown after it runs]";
  const budget = maxBytes - Buffer.byteLength(marker, "utf8");

  let slice = s.slice(0, budget);
  while (Buffer.byteLength(slice, "utf8") > budget) {
    slice = slice.slice(0, -1);
  }
  return slice + marker;
}
