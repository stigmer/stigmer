// Single source of truth for a workspace entry's file listing.
//
// Both surfaces that need a listing read through here: the Files accordion
// (`useWorkspaceFiles`, one entry) and workspace search (`useWorkspaceFileSearch`,
// many entries). Keeping one module-level cache — keyed by the stable-within-page
// `entry.id` — guarantees the two never double-fetch or drift, and lets one fetch
// produce every shape a consumer needs (flat files for search, a tree for the
// accordion, and the truncation flag for the banner).

import { buildFileTree, type TreeNode } from "../internal/file-tree/index.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type {
  WorkspaceFileEntry,
  WorkspaceFileLister,
} from "./WorkspaceFileLister.js";

/**
 * A processed listing for one workspace entry.
 *
 * Advisory `notice` entries (e.g. GitHub's "tree truncated" marker) are removed
 * from {@link WorkspaceListing.files} and never enter {@link WorkspaceListing.tree};
 * their presence is collapsed into {@link WorkspaceListing.truncated} so both the
 * accordion and search render one honest "results may be incomplete" banner
 * instead of a fake, clickable row (DD-11).
 */
export interface WorkspaceListing {
  /** Openable entries (files and directories); advisory notices removed. */
  readonly files: readonly WorkspaceFileEntry[];
  /** Hierarchy of the openable files (directories excluded), ready for `FileTreeNode`. */
  readonly tree: readonly TreeNode[];
  /** `true` when the lister signalled the listing was incomplete (too many files). */
  readonly truncated: boolean;
}

/** Options for {@link loadEntryFiles}. */
export interface LoadEntryFilesOptions {
  /** Skip the cache and re-call the lister (the accordion's Refresh action). */
  readonly bustCache?: boolean;
}

const sharedCache = new Map<string, WorkspaceListing>();

/**
 * Returns a cached {@link WorkspaceListing} for an entry synchronously, or
 * `undefined` when nothing is cached. Lets a consumer render a warm listing
 * instantly (no loading flash) before deciding whether to fetch.
 */
export function peekEntryListing(entryId: string): WorkspaceListing | undefined {
  return sharedCache.get(entryId);
}

/**
 * Loads and caches the processed listing for a single workspace entry.
 *
 * Returns the cached listing when present (unless `bustCache`), otherwise calls
 * the platform-injected `lister`, processes the raw entries once, and caches the
 * result. Returns `null` when the lister returns `null` (substrate unsupported
 * for this entry) — the honest "unavailable here" signal, not cached.
 */
export async function loadEntryFiles(
  entry: WorkspaceEntry,
  lister: WorkspaceFileLister,
  options: LoadEntryFilesOptions = {},
): Promise<WorkspaceListing | null> {
  if (!options.bustCache) {
    const cached = sharedCache.get(entry.id);
    if (cached) return cached;
  }

  const raw = await lister(entry);
  if (raw === null) return null;

  const listing = buildListing(raw);
  sharedCache.set(entry.id, listing);
  return listing;
}

/** Processes a raw lister result into a {@link WorkspaceListing}. */
function buildListing(raw: readonly WorkspaceFileEntry[]): WorkspaceListing {
  const truncated = raw.some((entry) => entry.notice === true);
  const files = raw.filter((entry) => !entry.notice);
  const tree = buildFileTree(files.filter((entry) => !entry.isDirectory));
  return { files, tree, truncated };
}

/**
 * Clears the shared cache. Test-only seam for deterministic isolation.
 *
 * @internal
 */
export function __clearWorkspaceListingCache(): void {
  sharedCache.clear();
}
