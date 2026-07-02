import { createContext, useContext } from "react";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  fileReviewRowState,
  type FileReviewRowState,
} from "./file-review-status";

/**
 * Context value that carries the session's captured change sets to the
 * transcript tool rows that reference them, so a stamped file-edit row
 * (`ToolCall.file_change_set_id`) can badge itself with the set's live review
 * state — pending review, kept, discarded — right where the edit happened.
 *
 * The sibling of {@link ApprovalContext}, and the same discipline: provided by
 * {@link MessageThread}, keyed by a stable id, rebuilt only when the underlying
 * change sets actually change (structural sharing keeps set references stable
 * across streaming frames), and an empty default so consumers without a
 * provider render no badge (backward compatible).
 *
 * Read-only by design: the row badge is presentation of the set's state, never
 * a decision surface — decisions live exclusively on the set's decision bar
 * ({@link FileReviewCard}).
 */
export interface FileReviewContextValue {
  /** Every displayable change set across the session, keyed by `FileChangeSet.id`. */
  readonly changeSetsById: ReadonlyMap<string, FileChangeSet>;
}

const DEFAULT_VALUE: FileReviewContextValue = {
  changeSetsById: new Map(),
};

/** Context that supplies the session's change sets to stamped tool rows. */
export const FileReviewContext =
  createContext<FileReviewContextValue>(DEFAULT_VALUE);

/**
 * The review state a stamped tool row should badge, or `null` for no badge
 * (unstamped row, unknown set, or a file absent from its set — see
 * {@link fileReviewRowState} for the honest-degradation rules).
 *
 * @param fileChangeSetId The row's `ToolCall.file_change_set_id` (may be "").
 * @param rowPath The row's file path (the presenter's primary arg), used to
 *   resolve this file's verdict once the set is decided.
 */
export function useFileReviewRowState(
  fileChangeSetId: string,
  rowPath: string | null,
): FileReviewRowState | null {
  const { changeSetsById } = useContext(FileReviewContext);
  if (!fileChangeSetId) return null;
  return fileReviewRowState(changeSetsById.get(fileChangeSetId), rowPath);
}
