import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "@stigmer/react";
import type { WorkspaceEntry } from "@stigmer/react";

interface ListWorkspaceFilesResult {
  files: WorkspaceFileEntry[];
  truncated: boolean;
}

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
    return result.files;
  }, []);
}
