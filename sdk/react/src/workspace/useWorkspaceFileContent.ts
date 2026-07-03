"use client";

import { useMemo } from "react";
import { useFetch } from "../internal/useFetch.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type {
  WorkspaceFileContent,
  WorkspaceFileReader,
} from "./WorkspaceFileReader.js";

/** Options for {@link useWorkspaceFileContent}. */
export interface UseWorkspaceFileContentOptions {
  /** The workspace entry that owns the file, or `null` when nothing is open. */
  readonly entry: WorkspaceEntry | null;
  /** Repo-relative (git) or root-relative (local) path, or `null` when nothing is open. */
  readonly path: string | null;
  /**
   * Platform-injected content reader. `undefined` when the host app injects
   * no reader at all (e.g. web with no GitHub token) — surfaced as
   * {@link UseWorkspaceFileContentReturn.isUnsupported}, not an error.
   */
  readonly reader: WorkspaceFileReader | undefined;
}

/** Return value of {@link useWorkspaceFileContent}. */
export interface UseWorkspaceFileContentReturn {
  /**
   * The decoded file content (+ metadata), or `null` while the request is
   * in-flight, skipped, failed, or the substrate is unsupported. A present
   * object with `text === null` is a real file that is binary, too large, or
   * undecodable — distinct from `isUnsupported`.
   */
  readonly content: WorkspaceFileContent | null;
  /** `true` only on the first load, before any content has arrived. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale content is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed read (a reader throw), or `null` when healthy. */
  readonly error: Error | null;
  /**
   * `true` when no reader can serve this file — either no reader was injected
   * or the reader reported the entry's substrate as unsupported (git-on-desktop,
   * local-on-web, missing token). This is the honest "not available here" state,
   * never an error.
   */
  readonly isUnsupported: boolean;
  /** Imperatively re-read the current file. Stale content stays visible. */
  readonly refetch: () => void;
}

/**
 * Wrapping the resolved `WorkspaceFileContent | null` in an object lets
 * `useFetch` distinguish "resolved to unsupported" (`content: null`) from its
 * own `initialData` sentinel without the two colliding — the object reference
 * is always present after a completed fetch.
 */
interface FileContentData {
  readonly content: WorkspaceFileContent | null;
}

const EMPTY_CONTENT: FileContentData = { content: null };

/**
 * Behavior hook that reads a single workspace file's content on demand.
 *
 * The byte-reading peer of {@link import("./useWorkspaceFiles.js").useWorkspaceFiles}
 * (which lists the tree), built on the same {@link useFetch} engine as the
 * content-fetch family ({@link import("../execution/useArtifactContent.js").useArtifactContent},
 * `useToolOutputContent`, `useFileChangeContent`) so it inherits their
 * stale-while-revalidate, cancellation, and `refetch` semantics for free.
 *
 * Deliberately passes **no** `cacheKey`: file bodies (up to
 * {@link import("./WorkspaceFileReader.js").MAX_WORKSPACE_FILE_READ_BYTES})
 * do not belong in the cross-mount metadata cache, which is sized for small,
 * hot resources. Re-opening a file re-reads it — the correct trade for a
 * read-only viewer.
 *
 * Maps the reader's two failure axes onto distinct states:
 * - reader resolves `null` (unsupported substrate) -> {@link UseWorkspaceFileContentReturn.isUnsupported}
 * - reader **throws** (404, network, unreadable) -> {@link UseWorkspaceFileContentReturn.error}
 *
 * Pass `null` for `entry`/`path` (or an `undefined` reader) to stay idle —
 * the established `useFetch` convention.
 *
 * @example
 * ```tsx
 * const { content, isLoading, error, isUnsupported } = useWorkspaceFileContent({
 *   entry,
 *   path: "src/index.ts",
 *   reader: workspaceFileReader,
 * });
 * ```
 */
export function useWorkspaceFileContent({
  entry,
  path,
  reader,
}: UseWorkspaceFileContentOptions): UseWorkspaceFileContentReturn {
  // The fetch runs only when a reader, an entry, and a path are all present.
  const enabled = !!(reader && entry && path);

  const { data, isLoading, isRefetching, error, refetch } =
    useFetch<FileContentData>(
      enabled
        ? () => reader(entry, path).then((c) => ({ content: c }))
        : null,
      // Identity deps: a change to any of these is a different file to read.
      [entry?.id ?? null, path ?? null, reader],
      EMPTY_CONTENT,
    );

  // Unsupported = no reader at all, or a completed fetch that resolved to null
  // (the reader's "this substrate isn't mine" signal). In-flight and error
  // states are excluded so the viewer shows loading/error, not "unavailable".
  const isUnsupported =
    !reader || (enabled && !isLoading && !error && data.content === null);

  return useMemo(
    () => ({
      content: data.content,
      isLoading,
      isRefetching,
      error,
      isUnsupported,
      refetch,
    }),
    [data.content, isLoading, isRefetching, error, isUnsupported, refetch],
  );
}
