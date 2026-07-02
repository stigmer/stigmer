import type {
  CapturedFileChange,
  FileChangeSet,
  FileDecision,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  DiffCompleteness,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewBlockReason,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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

/**
 * How completely a whole {@link FileChangeSet} can be reviewed — the set-level
 * sibling of {@link FileReviewability} that decides whether the set can be kept
 * in one action. Drives the card's bulk affordance and keeps headless builders
 * on the same classification.
 *
 * - `"complete"` — every file is reviewable; the set can be approved as-is.
 * - `"binary-only"` — the set's ONLY blocker is binary files (every non-binary
 *   file is fully reviewable). No text diff for the binaries, but their exact
 *   bytes are captured and reconcilable, so the whole set can be KEPT in one
 *   acknowledged action ("Keep all"). Includes mixed sets (text edits + images).
 * - `"blocked"` — at least one file is unavailable to review with no keepable
 *   bytes (secret-withheld / size-elided / uncapturable), so the set cannot be
 *   approved at once; it must be resolved per file.
 */
export type ChangeSetReviewability = "complete" | "binary-only" | "blocked";

/**
 * Classify a {@link FileChangeSet} from its server-derived `diff_completeness`
 * rollup (the field exists precisely so clients need not re-fold the per-file
 * signals). The runner and the size backstop both derive that value from the
 * same rule the backend gate re-checks, so this classification, the per-file
 * {@link fileReviewability} fold, and the server gate agree by construction.
 */
export function changeSetReviewability(set: FileChangeSet): ChangeSetReviewability {
  switch (set.diffCompleteness) {
    case DiffCompleteness.COMPLETE:
      return "complete";
    case DiffCompleteness.BINARY_SUMMARY_ONLY:
      return "binary-only";
    default:
      return "blocked";
  }
}

/**
 * Each file's EFFECTIVE verdict for a settled set, folding the decisions the
 * way the runner reconcile does (most-specific-wins): the last CHANGE_SET
 * decision is the baseline for every file, and a later-or-earlier FILE decision
 * overrides it for that file (FILE > CHANGE_SET regardless of ledger order;
 * within a scope, last write wins).
 *
 * This is the fold for DISPLAYING history — a set decided via "Keep all"
 * correctly reads every file as kept. The interactive per-file selected state
 * deliberately uses the FILE-only fold instead (a CHANGE_SET decision cannot
 * coexist with an open review, so it never pre-selects anything there).
 */
export function deriveEffectiveVerdicts(
  set: FileChangeSet,
): ReadonlyMap<string, FileDecisionAction> {
  let bulk: FileDecisionAction | null = null;
  const byFileId = new Map<string, FileDecisionAction>();
  for (const d of set.decisions as readonly FileDecision[]) {
    if (d.scope === FileDecisionScope.CHANGE_SET) bulk = d.action;
    else if (d.scope === FileDecisionScope.FILE && d.fileChangeId) {
      byFileId.set(d.fileChangeId, d.action);
    }
  }
  const effective = new Map<string, FileDecisionAction>();
  for (const c of set.changes) {
    const verdict = byFileId.get(c.id) ?? bulk;
    if (verdict != null) effective.set(c.id, verdict);
  }
  return effective;
}

/**
 * The captured change a transcript row's file path refers to, or `null`. The
 * row's path may be absolute (harness tool args) while captured paths are
 * workspace-root-relative, so the match accepts an exact match or a
 * `/`-boundary suffix. Presentation-only — never a correlation key.
 */
export function changeForRowPath(
  set: FileChangeSet,
  rowPath: string,
): CapturedFileChange | null {
  if (!rowPath) return null;
  const normalized = rowPath.replace(/\\/g, "/");
  for (const c of set.changes) {
    const path = c.pathAfter || c.pathBefore;
    if (path && (normalized === path || normalized.endsWith(`/${path}`))) {
      return c;
    }
  }
  return null;
}

/**
 * The review state a stamped transcript row should badge — how this file edit
 * stands in its change set's review lifecycle. `null` means "show no badge",
 * chosen over guessing: a missing set (not yet projected), a CAPTURING set, or
 * a row whose file is absent from the set (its edit was superseded or fully
 * reverted within the turn) renders unbadged, never mislabeled.
 *
 * - `"pending"` — the set is AWAITING_REVIEW; this edit's net result is on the
 *   decision surface now.
 * - `"kept"` / `"discarded"` — the set is decided/reconciled and this file's
 *   effective verdict is known ({@link deriveEffectiveVerdicts}).
 * - `"failed"` — the set's reconcile failed; the workspace outcome for this
 *   edit is not the reviewed one.
 */
export type FileReviewRowState = "pending" | "kept" | "discarded" | "failed";

export function fileReviewRowState(
  set: FileChangeSet | undefined,
  rowPath: string | null,
): FileReviewRowState | null {
  if (!set) return null;
  switch (set.status) {
    case FileChangeSetStatus.AWAITING_REVIEW:
      return "pending";
    case FileChangeSetStatus.FAILED:
      return "failed";
    case FileChangeSetStatus.DECIDED:
    case FileChangeSetStatus.RECONCILED: {
      if (!rowPath) return null;
      const change = changeForRowPath(set, rowPath);
      if (!change) return null;
      const verdict = deriveEffectiveVerdicts(set).get(change.id);
      if (verdict === FileDecisionAction.APPROVE) return "kept";
      if (verdict === FileDecisionAction.REJECT) return "discarded";
      return null;
    }
    default:
      return null;
  }
}
