import { createContext, useContext } from "react";
import type {
  CapturedFileChange,
  FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { FileReviewSet } from "@stigmer/sdk";
import {
  fileForRowPath,
  fileReviewRowChange,
  fileReviewRowState,
  type FileReviewRowState,
} from "./file-review-status.js";

/**
 * Context value that carries the session's file reviews to the transcript
 * tool rows, so a file-edit row can badge itself with the live review state
 * of the file it changed — pending review, kept, discarded — right where the
 * edit happened, and a write row can render its file's captured diff.
 *
 * A row is linked to a review by its turn (the tool use's run, whose
 * `fileReview` sets hold the turn's changes) and its path. What is decided
 * comes only from the session's fold; the captured bytes a diff renders come
 * from the turns' runs.
 *
 * The sibling of {@link ApprovalContext}, and the same discipline: provided
 * by {@link MessageThread}, rebuilt only when the underlying sets change (the
 * fold keeps unchanged set references), and an empty default so consumers
 * without a provider render no badge.
 *
 * Read-only by design: the row badge is presentation, never a decision
 * surface — decisions live on the set's decision bar ({@link FileReviewCard}).
 */
export interface FileReviewContextValue {
  /** Each turn's file reviews from the session's fold, keyed by the turn's run id. */
  readonly fileReviewByRunId: ReadonlyMap<string, readonly FileReviewSet[]>;
  /** The captured change sets (the runs' bytes), keyed by change set id. */
  readonly changeSetsById: ReadonlyMap<string, FileChangeSet>;
}

const DEFAULT_VALUE: FileReviewContextValue = {
  fileReviewByRunId: new Map(),
  changeSetsById: new Map(),
};

/** Context that supplies the session's file reviews to the tool rows. */
export const FileReviewContext =
  createContext<FileReviewContextValue>(DEFAULT_VALUE);

const NO_SETS: readonly FileReviewSet[] = [];

/**
 * The review state a file-edit row should badge, or `null` for no badge (no
 * review for its turn yet, or a file absent from it — see
 * {@link fileReviewRowState}).
 *
 * @param runId The row's turn (`ToolUse.runId`).
 * @param rowPath The row's file path (the presenter's primary arg); pass
 *   `null` for a row that edits no file.
 */
export function useFileReviewRowState(
  runId: string,
  rowPath: string | null,
): FileReviewRowState | null {
  const { fileReviewByRunId } = useContext(FileReviewContext);
  return fileReviewRowState(fileReviewByRunId.get(runId) ?? NO_SETS, rowPath);
}

/**
 * The captured change a write row should render as its inline diff, or
 * `null` to keep the row's own content view: no review for its turn, a path
 * miss, a capture the runs do not hold, or a non-reviewable change (see
 * {@link fileReviewRowChange}).
 *
 * The diff sibling of {@link useFileReviewRowState}: both match the row's
 * path against the same turn's review, so a row's badge and its diff always
 * describe the same file.
 *
 * @param runId The row's turn (`ToolUse.runId`).
 * @param rowPath The row's file path; `null` for a row that writes no file.
 */
export function useFileReviewRowChange(
  runId: string,
  rowPath: string | null,
): CapturedFileChange | null {
  const { fileReviewByRunId, changeSetsById } = useContext(FileReviewContext);
  if (!rowPath) return null;
  const sets = fileReviewByRunId.get(runId) ?? NO_SETS;
  for (let i = sets.length - 1; i >= 0; i--) {
    const set = sets[i]!;
    if (fileForRowPath(set, rowPath)) {
      return fileReviewRowChange(changeSetsById.get(set.changeSetId), rowPath);
    }
  }
  return null;
}
