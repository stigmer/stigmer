// Projects a CapturedFileChange (the file-review ledger/domain type) onto the
// FileChange display view-model that every diff renderer speaks.
//
// The two representations coexist by design (see the CapturedFileChange proto
// comment): CapturedFileChange is the apply-then-review domain type (always
// whole-file, byte-exact before/after, carries digests / capture_class /
// blocked_reason for enforcement), while FileChange is the *display superset* —
// it additionally models captureLevel and inline HUNK_ONLY diffs, which the
// still-live deny-gate approval produces directly. Because FileChange is the
// superset, this projection is lossless; the reverse would not be (a whole-file
// CapturedFileChange has no inline hunk to lose, but a HUNK_ONLY FileChange has
// no whole-file bytes). That asymmetry is exactly why display renders through
// FileChange and this adapter only ever runs one way.
//
// This is a pure derive-on-read projection from the single source (the ledger),
// not a stored second copy: it is called at render time by both FileReviewCard
// and useSessionFileChanges, never persisted.
//
// Framework-agnostic (no React) so it is shared across @stigmer/react,
// @stigmer/ink, and mirror-able by the Go CLI, alongside tool-view.ts.

import { create } from "@bufbuild/protobuf";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeKind,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Adapts a {@link CapturedFileChange} to the {@link FileChange} the diff
 * renderers consume. The two reuse the same `FileContent` for before/after, so
 * the bodies map directly; a capture is always WHOLE_FILE (the candidate carries
 * the byte-exact sides), so the resulting `FileChange` renders as a true
 * before/after diff.
 *
 * @param captured - A captured file change from a `FileChangeSet`.
 * @returns The equivalent display-side {@link FileChange}.
 */
export function toDisplayFileChange(captured: CapturedFileChange): FileChange {
  return create(FileChangeSchema, {
    path: captured.pathAfter || captured.pathBefore,
    changeType: toFileChangeType(captured.kind),
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: captured.before,
    after: captured.after,
    // The runner's capture-time display counts ride along so renderers can
    // show `+N −M` even when a body has been offloaded and no inline diff is
    // computable. Zero means "no count exists" (binary/withheld/legacy) —
    // consumers hide the stat, never show "+0 −0".
    linesAdded: captured.linesAdded,
    linesRemoved: captured.linesRemoved,
    renameFrom:
      captured.kind === FileChangeKind.RENAME ? captured.pathBefore : "",
  });
}

/** Maps the ledger's {@link FileChangeKind} to the display {@link FileChangeType}. */
function toFileChangeType(kind: FileChangeKind): FileChangeType {
  switch (kind) {
    case FileChangeKind.ADD:
      return FileChangeType.CREATE;
    case FileChangeKind.DELETE:
      return FileChangeType.DELETE;
    case FileChangeKind.RENAME:
      return FileChangeType.RENAME;
    default:
      return FileChangeType.MODIFY;
  }
}
