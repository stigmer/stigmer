// Projects a CapturedFileChange (one file of the run's file record,
// `RunStatus.file_changes`) onto the DisplayFileChange every diff renderer
// speaks: the path to show, the change as one word, the two sides' bodies
// and the capture-time line counts.
//
// A capture is always whole-file: the candidate carries the byte-exact
// before and after, so a display change renders as a true before/after diff.
// What was decided about the file is not here; that is the session's
// `stigmer.file_review.*` events, folded by @stigmer/session-log.
//
// A pure derive-on-read projection, called at render time by the review
// card and the session's Changes surface, never stored.
//
// Framework-agnostic (no React) so it is shared across @stigmer/react and
// @stigmer/ink, alongside tool-view.ts.

import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { FileContent } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

/**
 * How a file changed, in the word the session's file-review events use
 * (`FileReviewFile.change` in @stigmer/session-log).
 */
export type DisplayFileChangeType = "added" | "modified" | "deleted" | "renamed";

/** One changed file, as a diff renderer shows it. */
export interface DisplayFileChange {
  /** The file's path after the change (its path before, for a deletion). */
  readonly path: string;
  readonly changeType: DisplayFileChangeType;
  /** The file before the change; undefined for an added file. */
  readonly before: FileContent | undefined;
  /** The file after the change; undefined for a deleted file. */
  readonly after: FileContent | undefined;
  /**
   * The runner's capture-time line counts, so a renderer can show `+N -M`
   * even when a body was offloaded and no inline diff is computable. Zero
   * means no count exists (binary or withheld): hide the stat, never show
   * "+0 -0".
   */
  readonly linesAdded: number;
  readonly linesRemoved: number;
  /** The path before a rename; "" for any other change. */
  readonly renameFrom: string;
}

/**
 * Adapts a {@link CapturedFileChange} to the {@link DisplayFileChange} the
 * diff renderers consume.
 *
 * @param captured - A captured file change from a run's file record.
 * @returns The display-side change.
 */
export function toDisplayFileChange(captured: CapturedFileChange): DisplayFileChange {
  return {
    path: captured.pathAfter || captured.pathBefore,
    changeType: displayChangeTypeOf(captured.kind),
    before: captured.before,
    after: captured.after,
    linesAdded: captured.linesAdded,
    linesRemoved: captured.linesRemoved,
    renameFrom: captured.kind === FileChangeKind.RENAME ? captured.pathBefore : "",
  };
}

/** Maps the file record's {@link FileChangeKind} to its display word. */
export function displayChangeTypeOf(kind: FileChangeKind): DisplayFileChangeType {
  switch (kind) {
    case FileChangeKind.ADD:
      return "added";
    case FileChangeKind.DELETE:
      return "deleted";
    case FileChangeKind.RENAME:
      return "renamed";
    default:
      return "modified";
  }
}
