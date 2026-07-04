// Content-search capability — the text-grep sibling of WorkspaceFileLister
// (which does filename/path search over a cached listing). Injected by the host
// (DD-004) so the SDK never learns how the grep runs: a native ripgrep-backed
// walker on desktop; `null` (unsupported) on web/git until a branch-accurate
// backend search exists (DD-09).

import type { WorkspaceEntry } from "./useWorkspaceEntries.js";

/**
 * A single content-search hit: a line in a workspace file whose text contains
 * the query.
 *
 * Deliberately line-level and column-free. The consumer recomputes the
 * highlight range from `preview` + query (a case-insensitive substring), so a
 * byte/column offset would be an unused field until jump-to-line ships — at
 * which point `line` is the anchor. `preview` is guaranteed to contain the
 * match even for long lines (the backend windows it around the first hit).
 */
export interface WorkspaceContentMatch {
  /** Repo-relative (git) or root-relative (local) path of the matched file. */
  readonly path: string;
  /** 1-based line number of the match within the file. */
  readonly line: number;
  /** The matched line's text, windowed so the match stays visible. */
  readonly preview: string;
}

/**
 * The result of searching one workspace entry: its hits plus whether a cap
 * stopped the search early.
 *
 * A result object (rather than a bare `WorkspaceContentMatch[]`) so the
 * per-root `truncated` signal survives to the UI — mirroring how
 * {@link import("./WorkspaceFileReader.js").WorkspaceFileReader} returns a
 * `WorkspaceFileContent` object with its own `truncated` flag rather than raw
 * text. `truncated` means "there are more matches than shown for this entry".
 */
export interface WorkspaceContentSearchResult {
  /** Ranked hits (backend order: path, then line). */
  readonly matches: readonly WorkspaceContentMatch[];
  /** `true` when a per-file or workspace cap stopped the search early. */
  readonly truncated: boolean;
}

/**
 * Platform-injected callback that searches file *contents* within one workspace
 * entry for a case-insensitive substring.
 *
 * The text-grep sibling of {@link import("./WorkspaceFileLister.js").WorkspaceFileLister}:
 * the SDK calls it (per entry, debounced) while the user types in the Search
 * pane's Text mode; the platform decides *how* the grep runs.
 *
 * Two distinct outcomes — do not conflate them:
 * - Returns `null` **only** when content search is unsupported for this entry
 *   (a git entry on desktop, any entry on web until a backend search exists).
 *   This is the honest "unavailable here" state, mirroring the lister's null
 *   contract — the whole workspace being `null` disables Text search.
 * - **Throws** on a genuine failure (unreadable root, backend error). Consumers
 *   isolate this per entry so one failing root never blanks the rest.
 *
 * Implementations:
 * - **Desktop:** Tauri `search_workspace_content` (ripgrep `ignore` walker +
 *   `grep-searcher`, respecting `.gitignore`, skipping binary/oversized files).
 * - **Web:** `undefined`/`null` — GitHub code search is default-branch-only and
 *   would disagree with the branch the viewer reads (DD-09).
 */
export type WorkspaceContentSearcher = (
  entry: WorkspaceEntry,
  query: string,
) => Promise<WorkspaceContentSearchResult | null>;
