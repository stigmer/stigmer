import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileReviewBlockReason } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Why an `"unavailable"` file cannot be reviewed — the honest per-file cause the
 * runner records on `CapturedFileChange.blocked_reason` (design doc 15).
 *
 * - `"secret"` — the path looks like a secret; the bytes were deliberately never
 *   captured (there is nothing to review, by design).
 * - `"size"` — the diff was captured but its bodies were dropped to keep the
 *   persisted status under its size limit.
 * - `"unknown"` — incomplete for a reason the wire does not name (a defensive
 *   catch-all; historical rows and future/unmapped causes land here).
 */
export type FileBlockReason = "secret" | "size" | "unknown";

/**
 * How completely a single captured file change can be reviewed before a decision
 * is made — the classification that decides whether a file can be kept. A
 * discriminated union so every consumer handles each case exhaustively and reads
 * the block reason from one place (no "classify, then separately look up why").
 *
 * - `{ kind: "reviewable" }` — the full before/after diff is available; the
 *   reviewer can see exactly what changed and Keep or Discard it.
 * - `{ kind: "binary" }` — a binary file changed; there is no text diff to
 *   review (the bytes are captured and flagged, but a byte diff is not
 *   human-reviewable). Binary is proven by `FileContent.is_binary`, not by the
 *   block reason.
 * - `{ kind: "unavailable"; reason }` — the diff is not available to review at
 *   all, with the honest {@link FileBlockReason} the runner recorded.
 *
 * Both `"binary"` and `"unavailable"` are non-reviewable: the file cannot be
 * approved (kept), only discarded. This mirrors the server, which blocks
 * approval of any change set that is not fully complete.
 */
export type FileReviewability =
  | { readonly kind: "reviewable" }
  | { readonly kind: "binary" }
  | { readonly kind: "unavailable"; readonly reason: FileBlockReason };

/**
 * Classify a {@link CapturedFileChange} by how completely it can be reviewed,
 * from the signals the runner authors onto the change (see the file-review
 * producer in the runner's `shared/filereview`).
 *
 * The mapping is derived from three proto signals, in order:
 *
 * 1. `diff_complete === true` → `"reviewable"`. The change set can only be
 *    `COMPLETE` when every file is complete, so a complete file is always
 *    reviewable.
 * 2. otherwise, a binary side (`before.is_binary` or `after.is_binary`) →
 *    `"binary"`. The runner marks a git-tracked file incomplete precisely
 *    because a side is binary (`diff_complete = !binary`); a CAS file carries
 *    `is_binary` on its blob ref. `is_binary` is preserved when a large body is
 *    offloaded from an inline value to a storage ref, so this holds regardless
 *    of offload. Binary is therefore derived here, never duplicated onto the
 *    block reason (doc 15).
 * 3. otherwise → `"unavailable"` with the honest cause from
 *    `blocked_reason`: `SECRET_WITHHELD → "secret"`, `SIZE_ELIDED → "size"`,
 *    else `"unknown"`. Before doc 15 this bucket was cause-agnostic (the wire
 *    could not prove secret-withheld vs size-dropped); the runner now records
 *    the cause at capture time, so the UI can say *why* rather than only *that*
 *    the diff is unavailable.
 */
export function fileReviewability(change: CapturedFileChange): FileReviewability {
  if (change.diffComplete) return { kind: "reviewable" };
  if (change.before?.isBinary || change.after?.isBinary) return { kind: "binary" };
  return { kind: "unavailable", reason: blockReasonOf(change.blockedReason) };
}

/** Map the proto {@link FileReviewBlockReason} to the UI {@link FileBlockReason}. */
function blockReasonOf(reason: FileReviewBlockReason): FileBlockReason {
  switch (reason) {
    case FileReviewBlockReason.SECRET_WITHHELD:
      return "secret";
    case FileReviewBlockReason.SIZE_ELIDED:
      return "size";
    default:
      return "unknown";
  }
}
