import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "@stigmer/react";
import type { WorkspaceEntry } from "@stigmer/react";

interface ListWorkspaceFilesResult {
  files: WorkspaceFileEntry[];
  truncated: boolean;
}

/**
 * Advisory entry appended when the Rust walker caps a large folder. The SDK's
 * listing cache collapses any `notice` entry into a single `truncated` banner
 * and strips it from the openable list, so this `path` string is never rendered
 * (DD-11) — it only marks the signal. Mirrors the GitHub lister's marker.
 */
const TRUNCATION_MARKER: WorkspaceFileEntry = {
  path: "... (listing truncated — folder has too many files)",
  isDirectory: false,
  notice: true,
};

/**
 * Returns a stable {@link WorkspaceFileLister} that lists local workspace
 * files via a Tauri IPC command backed by the Rust `ignore` crate.
 *
 * - For `entry.type === "local"` entries, invokes the Rust-side
 *   `list_workspace_files` command which walks the directory with full
 *   `.gitignore` support (nested rules, `.git/info/exclude`, global
 *   gitconfig excludes) and caps at 10,000 entries.
 * - Returns `null` for non-local entries (git entries are not listable
 *   on desktop — the runner clones them at execution time).
 * - When the walker caps the folder, appends a {@link TRUNCATION_MARKER} so the
 *   SDK surfaces the same incomplete-listing banner the web (GitHub) lister does
 *   (DD-11 desktop parity).
 *
 * Designed to be passed as the `workspaceFileLister` prop to
 * `SessionViewer` / `NewSessionViewer` (DD-016 parity with web).
 */
export function useNativeWorkspaceFiles(): WorkspaceFileLister {
  return useCallback(async (entry: WorkspaceEntry) => {
    if (entry.type !== "local" || !entry.localPath) return null;

    const result = await invoke<ListWorkspaceFilesResult>(
      "list_workspace_files",
      { path: entry.localPath },
    );
    return result.truncated
      ? [...result.files, TRUNCATION_MARKER]
      : result.files;
  }, []);
}
