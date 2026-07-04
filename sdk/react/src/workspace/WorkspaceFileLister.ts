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
  /**
   * Marks this entry as an advisory notice rather than an openable file — for
   * example a "listing truncated" message when a repository exceeds the
   * backend's entry limit. When `true`, `path` carries the human-readable
   * message. Consumers must not treat a notice as a real file: it is stripped
   * from the openable listing (never a tree leaf, never a search hit) and is
   * surfaced instead as a single `truncated` banner (see `workspaceListingCache`).
   *
   * Optional and additive: listers that never truncate simply omit it.
   */
  readonly notice?: true;
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
