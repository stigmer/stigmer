import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceEntry,
  WorkspaceFileContent,
  WorkspaceFileReader,
} from "@stigmer/react";

/**
 * Returns a stable {@link WorkspaceFileReader} that reads local workspace file
 * content via the Rust `read_workspace_file` command.
 *
 * - For `entry.type === "local"` entries, invokes the command with the entry's
 *   root and the repo/root-relative `path`. The Rust side enforces the 1 MB
 *   cap, NUL-byte binary detection, and path-traversal rejection, and returns
 *   the `WorkspaceFileContent` shape directly.
 * - Returns `null` for non-local entries (git content is not readable on
 *   desktop — the runner clones repos at execution time), mirroring
 *   `useNativeWorkspaceFiles`.
 * - Real failures (missing file, directory, unreadable) surface as a rejected
 *   invoke and propagate to the caller — never collapsed into `null`.
 */
export function useNativeWorkspaceFileReader(): WorkspaceFileReader {
  return useCallback(
    async (entry: WorkspaceEntry, path: string): Promise<WorkspaceFileContent | null> => {
      if (entry.type !== "local" || !entry.localPath) return null;

      return await invoke<WorkspaceFileContent>("read_workspace_file", {
        root: entry.localPath,
        relativePath: path,
      });
    },
    [],
  );
}
