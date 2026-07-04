// Correlate an open workspace-file selection with the session file change that
// touched it, so the read-only Viewer can default a changed file to its diff
// (Slice 4). This is the change-side peer of `resolveWorkspaceFileSelection`.
//
// The hard part is again PATH FORM, and — critically — ENTRY IDENTITY. A
// `FileChange` carries a capture-side path (`path` is workspace-root-relative,
// falling back to `absolutePath`), while the selection is the reader's
// `{ entryId, path }`. Matching by a bare `/`-boundary suffix (as the
// presentation-only `changeForRowPath` does) is deliberately NOT used here: in
// a multi-repo session it would happily match `repoA/src/a.ts` to a change in
// `repoB/src/a.ts` and render the wrong file's diff.
//
// Instead we route each change's path through the SAME correlation-grade
// resolver (`resolveWorkspaceFileSelection`) the tree and transcript use to
// open files, with the SAME `entries` and `sandboxWorkspaceRoot`. A change is
// the open file's change iff it resolves to the exact `{ entryId, path }`
// currently selected. Single-entry sessions match exactly; ambiguous
// multi-entry / absolute paths degrade to "no match" (never a wrong match),
// inheriting DD-08's honesty. One resolver, one truth.

import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SelectedWorkspaceFile } from "../internal/store/workspace-file-selection-store.js";
import { resolveWorkspaceFileSelection } from "./resolveWorkspaceFileSelection.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";

/**
 * The session {@link FileChange} that touched the currently-open file, or
 * `null` when the open file was not changed this session (or cannot be
 * correlated with certainty).
 *
 * @param selection - The open file, keyed by `entryId` + repo/root-relative `path`.
 * @param fileChanges - Net-per-file session changes (from `useSessionFileChanges`).
 * @param entries - The client workspace entries — the SAME list the tree and
 *   transcript resolve against (`flow.workspace.entries`), so the returned
 *   `entryId` is directly comparable. Do not pass the proto `workspaceEntries`.
 * @param sandboxWorkspaceRoot - The sandbox root for git sessions (strips
 *   cloud-absolute change paths), identical to the transcript resolver's input.
 * @returns The matching change, or `null`.
 */
export function findChangeForSelection(
  selection: SelectedWorkspaceFile,
  fileChanges: readonly FileChange[],
  entries: readonly WorkspaceEntry[],
  sandboxWorkspaceRoot?: string,
): FileChange | null {
  for (const change of fileChanges) {
    const resolved = resolveWorkspaceFileSelection(
      change.path || change.absolutePath,
      entries,
      sandboxWorkspaceRoot,
    );
    if (
      resolved !== null &&
      resolved.entryId === selection.entryId &&
      resolved.path === selection.path
    ) {
      return change;
    }
  }
  return null;
}
