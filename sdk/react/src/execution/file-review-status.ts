import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";

/**
 * How completely a single captured file change can be reviewed before a decision
 * is made — the classification that decides whether a file can be kept.
 *
 * - `"reviewable"` — the full before/after diff is available; the reviewer can
 *   see exactly what changed and Keep or Discard it.
 * - `"binary"` — a binary file changed; there is no text diff to review (the
 *   bytes are captured and flagged, but a byte diff is not human-reviewable).
 * - `"unavailable"` — the diff is not available to review at all. This is
 *   deliberately **cause-agnostic**: it covers a diff the runner refused to
 *   capture (the secret gate) *and* one that was captured then dropped to keep
 *   the persisted status under its size limit. Both arrive on the wire as the
 *   same shape, so surfacing a specific cause would be a claim the data cannot
 *   support (see {@link fileReviewability}).
 *
 * Both `"binary"` and `"unavailable"` are non-reviewable: the file cannot be
 * approved (kept), only discarded. This mirrors the server, which blocks
 * approval of any change set that is not fully complete.
 */
export type FileReviewability = "reviewable" | "binary" | "unavailable";

/**
 * Classify a {@link CapturedFileChange} by how completely it can be reviewed,
 * from the signals the runner authors onto the change (see the file-review
 * producer in the runner's `shared/filereview`).
 *
 * The mapping is intentionally derived from exactly two proto signals, in order:
 *
 * 1. `diff_complete === true` → `"reviewable"`. The change set can only be
 *    `COMPLETE` when every file is complete, so a complete file is always
 *    reviewable.
 * 2. otherwise, a binary side (`before.is_binary` or `after.is_binary`) →
 *    `"binary"`. The runner marks a git-tracked file incomplete precisely
 *    because a side is binary (`diff_complete = !binary`); a CAS file carries
 *    `is_binary` on its blob ref. `is_binary` is preserved when a large body is
 *    offloaded from an inline value to a storage ref, so this holds regardless
 *    of offload.
 * 3. otherwise → `"unavailable"`.
 *
 * The third bucket is cause-agnostic on purpose. A secret-gate-blocked path
 * (authored content-less) and a size-elided file (captured, then its inline
 * bodies dropped and the file marked incomplete to bound the persisted status)
 * reach the UI as the **same** shape — content-less, `diff_complete = false`,
 * not binary. The only incidental difference is `capture_class`, which is a
 * backstop-implementation detail the UI must not read a user-facing cause from.
 * Distinguishing them honestly would require a first-class per-file reason on
 * the proto; until that exists, the UI reports what it can prove ("the diff
 * isn't available to review") and no more.
 */
export function fileReviewability(change: CapturedFileChange): FileReviewability {
  if (change.diffComplete) return "reviewable";
  if (change.before?.isBinary || change.after?.isBinary) return "binary";
  return "unavailable";
}
