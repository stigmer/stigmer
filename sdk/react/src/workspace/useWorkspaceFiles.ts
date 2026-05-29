"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFileTree, type TreeNode } from "../internal/file-tree";
import { toError } from "../internal/toError";
import type { WorkspaceEntry } from "./useWorkspaceEntries";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "./WorkspaceFileLister";

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
  /** Re-fetch the file listing for the current entry (cache-bust). */
  readonly refresh: () => void;
}

interface CacheEntry {
  files: WorkspaceFileEntry[];
  tree: TreeNode[];
}

const EMPTY_TREE: readonly TreeNode[] = [];

/**
 * Behavior hook that fetches and caches a file listing for a single
 * workspace entry, converting it into a {@link TreeNode} hierarchy.
 *
 * - Calls the platform-injected `lister` when the entry changes.
 * - Caches results per `entry.id` so tab switches and re-expands
 *   are instant without re-fetching.
 * - Returns an empty tree and skips the call when `lister` is
 *   `undefined` (graceful degradation — DD-011 opt-in).
 * - Memoizes the return value for referential stability (DD-010).
 *
 * @example
 * ```tsx
 * const { tree, isLoading, error, refresh } = useWorkspaceFiles({
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

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const fetchIdRef = useRef(0);

  const fetchFiles = useCallback(
    async (target: WorkspaceEntry, bustCache: boolean) => {
      if (!lister) return;

      if (!bustCache) {
        const cached = cacheRef.current.get(target.id);
        if (cached) {
          setTree(cached.tree);
          setError(null);
          setIsLoading(false);
          return;
        }
      }

      const id = ++fetchIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const files = await lister(target);

        if (fetchIdRef.current !== id) return;

        if (files === null) {
          setTree(EMPTY_TREE);
          setIsLoading(false);
          return;
        }

        const built = buildFileTree(files);
        cacheRef.current.set(target.id, { files, tree: built });
        setTree(built);
        setIsLoading(false);
      } catch (err) {
        if (fetchIdRef.current !== id) return;
        setError(toError(err));
        setTree(EMPTY_TREE);
        setIsLoading(false);
      }
    },
    [lister],
  );

  useEffect(() => {
    if (!entry || !lister) {
      setTree(EMPTY_TREE);
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
    () => ({ tree, isLoading, error, refresh }),
    [tree, isLoading, error, refresh],
  );
}
