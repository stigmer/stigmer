import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceContentSearchResult,
  WorkspaceContentSearcher,
  WorkspaceEntry,
} from "@stigmer/react";

/**
 * Returns a stable {@link WorkspaceContentSearcher} that greps local workspace
 * file contents via the Rust `search_workspace_content` command (ripgrep's
 * `ignore` walker + `grep-searcher`).
 *
 * - For `entry.type === "local"` entries, invokes the command with the entry's
 *   root and the query. The Rust side respects `.gitignore`, skips binary and
 *   oversized files, caps results, and returns the `{ matches, truncated }`
 *   shape directly.
 * - Returns `null` for non-local entries (git content is not searchable on
 *   desktop — the runner clones repos at execution time), mirroring
 *   `useNativeWorkspaceFiles`/`useNativeWorkspaceFileReader`.
 * - Real failures (unreadable root) surface as a rejected invoke and propagate
 *   to the caller — never collapsed into `null`.
 *
 * Designed to be passed as the `workspaceContentSearcher` prop to
 * `SessionViewer` / `NewSessionViewer` (DD-016 parity with web, which leaves it
 * undefined until a branch-accurate backend search exists — DD-09).
 */
export function useNativeWorkspaceContentSearcher(): WorkspaceContentSearcher {
  return useCallback(
    async (
      entry: WorkspaceEntry,
      query: string,
    ): Promise<WorkspaceContentSearchResult | null> => {
      if (entry.type !== "local" || !entry.localPath) return null;

      return await invoke<WorkspaceContentSearchResult>("search_workspace_content", {
        root: entry.localPath,
        query,
      });
    },
    [],
  );
}
