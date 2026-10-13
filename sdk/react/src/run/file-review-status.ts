// How a turn's file changes stand in review, read from the session's fold
// (`FileReviewSet`, `FileReviewFile`): what each file can be decided as, the
// whole set's bulk affordance, a transcript row's badge, and the change-kind
// word as the shared badge's enum. The captured bytes a diff renders stay
// on the run (`CapturedFileChange`); `changeForRowPath` and
// `fileReviewRowChange` find them for a row, never a decision.
import type {
  CapturedFileChange,
  FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileReviewFile, FileReviewSet } from "@stigmer/sdk";

/**
 * Why an `"unavailable"` file cannot be reviewed.
 *
 * - `"secret"` — the path looks like a secret; the bytes were deliberately
 *   never captured (there is nothing to review, by design).
 * - `"partial"` — the diff is incomplete: too large to keep, or not
 *   capturable.
 */
export type FileBlockReason = "secret" | "partial";

/**
 * How completely a single file change can be reviewed before it is decided —
 * the classification that decides whether a file can be kept.
 *
 * - `{ kind: "reviewable" }` — the full before/after diff is available.
 * - `{ kind: "binary" }` — a binary file changed: no text diff, but its exact
 *   bytes are captured, so it can be kept consciously ("Keep anyway").
 * - `{ kind: "unavailable"; reason }` — the diff is not available to review
 *   at all; the file can only be discarded.
 *
 * Mirrors the server, which refuses to keep a set that is not complete
 * unless every incompleteness is binary and acknowledged.
 */
export type FileReviewability =
  | { readonly kind: "reviewable" }
  | { readonly kind: "binary" }
  | { readonly kind: "unavailable"; readonly reason: FileBlockReason };

/**
 * Classify a file of a turn's review by its `reviewable` word (the runner's
 * `complete`, `binary`, `secret` or `partial`).
 */
export function fileReviewability(file: Pick<FileReviewFile, "reviewable">): FileReviewability {
  switch (file.reviewable) {
    case "complete":
      return { kind: "reviewable" };
    case "binary":
      return { kind: "binary" };
    case "secret":
      return { kind: "unavailable", reason: "secret" };
    default:
      return { kind: "unavailable", reason: "partial" };
  }
}

/**
 * How completely a whole set can be reviewed — the set-level sibling of
 * {@link FileReviewability} that decides whether the set can be kept in one
 * action.
 *
 * - `"complete"` — every file is reviewable; the set can be kept as-is.
 * - `"binary-only"` — the ONLY blocker is binary files: the whole set can be
 *   kept in one acknowledged action ("Keep all").
 * - `"blocked"` — at least one file is unavailable to review, so the set
 *   cannot be kept at once; it must be resolved per file.
 */
export type ChangeSetReviewability = "complete" | "binary-only" | "blocked";

/** Classify a set from its files' reviewability. */
export function changeSetReviewability(set: Pick<FileReviewSet, "files">): ChangeSetReviewability {
  let binary = false;
  for (const file of set.files) {
    const kind = fileReviewability(file).kind;
    if (kind === "unavailable") return "blocked";
    if (kind === "binary") binary = true;
  }
  return binary ? "binary-only" : "complete";
}

/** Whether a row's path names a changed file: an exact match or a `/`-boundary suffix (row paths may be absolute). */
function pathMatches(rowPath: string, path: string): boolean {
  const normalized = rowPath.replace(/\\/g, "/");
  return path !== "" && (normalized === path || normalized.endsWith(`/${path}`));
}

/**
 * The file of a turn's review a transcript row's path refers to, or `null`.
 * Presentation-only — never a correlation key.
 */
export function fileForRowPath(
  set: Pick<FileReviewSet, "files">,
  rowPath: string,
): FileReviewFile | null {
  if (!rowPath) return null;
  return set.files.find((file) => pathMatches(rowPath, file.path)) ?? null;
}

/**
 * The review state a file-edit row should badge — how the file it changed
 * stands in its turn's review. `null` means "show no badge", chosen over
 * guessing: a turn with no review yet, or a row whose file is absent from it
 * (its edit was superseded or reverted within the turn), renders unbadged.
 *
 * - `"pending"` — the file is undecided; it is on the decision surface now.
 * - `"kept"` / `"discarded"` — it was kept, or undone (or is being undone).
 * - `"failed"` — the undo failed; the workspace is not as decided.
 */
export type FileReviewRowState = "pending" | "kept" | "discarded" | "failed";

const ROW_STATE: Readonly<Record<FileReviewFile["state"], FileReviewRowState>> = {
  undecided: "pending",
  kept: "kept",
  undoing: "discarded",
  undone: "discarded",
  undo_failed: "failed",
};

/**
 * The {@link FileReviewRowState} of a row's file across a turn's review
 * sets (a later set wins), or `null`.
 */
export function fileReviewRowState(
  sets: ReadonlyArray<Pick<FileReviewSet, "files">>,
  rowPath: string | null,
): FileReviewRowState | null {
  if (!rowPath) return null;
  for (let i = sets.length - 1; i >= 0; i--) {
    const file = fileForRowPath(sets[i]!, rowPath);
    if (file) return ROW_STATE[file.state];
  }
  return null;
}

/**
 * The captured change (the run's bytes) a transcript row's file path refers
 * to, or `null`. The row's path may be absolute while captured paths are
 * workspace-root-relative, so the match accepts an exact match or a
 * `/`-boundary suffix. Presentation-only — never a correlation key.
 */
export function changeForRowPath(
  set: FileChangeSet,
  rowPath: string,
): CapturedFileChange | null {
  if (!rowPath) return null;
  for (const change of set.changes) {
    if (pathMatches(rowPath, change.pathAfter || change.pathBefore)) return change;
  }
  return null;
}

/**
 * The captured change a write row should render as its inline diff, or
 * `null` to keep the row's own content view: no capture, a path miss, or an
 * incomplete diff (binary, secret-withheld, elided) that cannot honestly
 * render.
 */
export function fileReviewRowChange(
  set: FileChangeSet | undefined,
  rowPath: string | null,
): CapturedFileChange | null {
  if (!set || !rowPath) return null;
  const change = changeForRowPath(set, rowPath);
  return change?.diffComplete ? change : null;
}

const CHANGE_KIND_OF_WORD: ReadonlyMap<string, FileChangeKind> = new Map([
  ["added", FileChangeKind.ADD],
  ["modified", FileChangeKind.MODIFY],
  ["deleted", FileChangeKind.DELETE],
  ["renamed", FileChangeKind.RENAME],
]);

/**
 * The {@link FileChangeKind} a file's change word names (`added`,
 * `modified`, `deleted`, `renamed`), for the shared change-kind badge;
 * `UNSPECIFIED` for any other word.
 */
export function fileChangeKindOf(change: string): FileChangeKind {
  return CHANGE_KIND_OF_WORD.get(change) ?? FileChangeKind.UNSPECIFIED;
}
