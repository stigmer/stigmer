"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../internal/file-tree/index.js";
import { toError } from "../internal/toError.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type { WorkspaceFileLister } from "./WorkspaceFileLister.js";
import { loadEntryFiles, peekEntryListing } from "./workspaceListingCache.js";

/** Options for {@link useWorkspaceFiles}. */
export interface UseWorkspaceFilesOptions {
  /** The workspace entry to list files for (`null` when nothing is selected). */
  readonly entry: WorkspaceEntry | null;
  /** Platform-injected lister callback. `undefined` when the host app does not support file listing. */
  readonly lister: WorkspaceFileLister | undefined;
}

/** Return value of {@link useWorkspaceFiles}. */
export interface UseWorkspaceFilesReturn {
  /** Hierarchical tree built from the file listing, ready for `FileTreeNode`. */
  readonly tree: readonly TreeNode[];
  /** `true` while the lister is being called. */
  readonly isLoading: boolean;
  /** Error from the lister, if any. */
  readonly error: Error | null;
  /**
   * `true` when the listing was truncated by the backend (repository too large).
   * The advisory entry is excluded from `tree`; callers render an incomplete-results
   * banner from this flag instead (DD-11).
   */
  readonly truncated: boolean;
  /** Re-fetch the file listing for the current entry (cache-bust). */
  readonly refresh: () => void;
}

const EMPTY_TREE: readonly TreeNode[] = [];

/**
 * Behavior hook that fetches and caches a file listing for a single
 * workspace entry, converting it into a {@link TreeNode} hierarchy.
 *
 * - Calls the platform-injected `lister` (via the shared
 *   {@link loadEntryFiles} cache) when the
 *   entry changes.
 * - Reads the shared listing cache so tab switches, re-expands, and the search
 *   surface are instant without re-fetching (one cache, keyed by `entry.id` +
 *   effective read ref — a ref advance is a cache miss by design).
 * - Returns an empty tree and skips the call when `lister` is
 *   `undefined` (graceful degradation — DD-011 opt-in).
 * - Memoizes the return value for referential stability (DD-010).
 *
 * @example
 * ```tsx
 * const { tree, isLoading, error, truncated, refresh } = useWorkspaceFiles({
 *   entry: selectedEntry,
 *   lister: workspaceFileLister,
 * });
 * ```
 */
export function useWorkspaceFiles({
  entry,
  lister,
}: UseWorkspaceFilesOptions): UseWorkspaceFilesReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tree, setTree] = useState<readonly TreeNode[]>(EMPTY_TREE);
  const [truncated, setTruncated] = useState(false);

  const fetchIdRef = useRef(0);

  const fetchFiles = useCallback(
    async (target: WorkspaceEntry, bustCache: boolean) => {
      if (!lister) return;

      if (!bustCache) {
        const cached = peekEntryListing(target);
        if (cached) {
          setTree(cached.tree);
          setTruncated(cached.truncated);
          setError(null);
          setIsLoading(false);
          return;
        }
      }

      const id = ++fetchIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const listing = await loadEntryFiles(target, lister, { bustCache });

        if (fetchIdRef.current !== id) return;

        if (listing === null) {
          setTree(EMPTY_TREE);
          setTruncated(false);
          setIsLoading(false);
          return;
        }

        setTree(listing.tree);
        setTruncated(listing.truncated);
        setIsLoading(false);
      } catch (err) {
        if (fetchIdRef.current !== id) return;
        setError(toError(err));
        setTree(EMPTY_TREE);
        setTruncated(false);
        setIsLoading(false);
      }
    },
    [lister],
  );

  useEffect(() => {
    if (!entry || !lister) {
      setTree(EMPTY_TREE);
      setTruncated(false);
      setIsLoading(false);
      setError(null);
      return;
    }
    fetchFiles(entry, false);
  }, [entry, lister, fetchFiles]);

  const refresh = useCallback(() => {
    if (entry && lister) {
      fetchFiles(entry, true);
    }
  }, [entry, lister, fetchFiles]);

  return useMemo(
    () => ({ tree, isLoading, error, truncated, refresh }),
    [tree, isLoading, error, truncated, refresh],
  );
}
