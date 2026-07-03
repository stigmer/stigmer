import type { WorkspaceEntry } from "./useWorkspaceEntries.js";

/**
 * A single file or directory entry returned by a {@link WorkspaceFileLister}.
 *
 * Matches the minimal contract consumed by `buildFileTree` — the tree
 * builder uses `path` for hierarchy construction and the workspace UI
 * uses `isDirectory` to annotate folder nodes.
 */
export interface WorkspaceFileEntry {
  /** Relative path from the workspace root (e.g. "src/index.ts"). */
  readonly path: string;
  /** Whether this entry is a directory. */
  readonly isDirectory: boolean;
}

/**
 * Platform-injected callback that lists files in a workspace entry.
 *
 * The SDK calls this when a user expands a workspace entry in the
 * inspector. The callback receives the entry and returns its file
 * listing. The SDK never knows *how* the listing was obtained —
 * that's the platform's concern (DD-004 capability injection).
 *
 * Implementations:
 * - **Web:** GitHub Trees API via the OAuth token
 * - **Desktop:** Tauri `readDir` with gitignore filtering (Phase 3)
 *
 * Returns `null` when listing is not supported for this entry type
 * (e.g., a local-path entry on web, or a git entry without a token).
 */
export type WorkspaceFileLister = (
  entry: WorkspaceEntry,
) => Promise<WorkspaceFileEntry[] | null>;
