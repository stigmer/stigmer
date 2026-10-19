"use client";

/**
 * Data and behaviour hooks over one Stigmer File, by id: its record (name,
 * type, size), a link to its bytes, and a click-to-save action.
 *
 * Trade-offs:
 * - A File's record never changes after upload, so it is cached across
 *   mounts by id: a thread that re-renders its chips reads the record once.
 * - A link expires, so {@link useFileDownloadUrl} mints one only while it
 *   is enabled (an image tile on screen) and {@link useFileDownload} mints
 *   a fresh one per click, never baking a link into rendered state that
 *   outlives it.
 */

import { useCallback, useMemo, useState } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useFetch } from "../internal/useFetch.js";
import { triggerBrowserDownload } from "../run/useArtifactDownload.js";

/** Return value of {@link useFile}. */
export interface UseFileReturn {
  /** The File's record, or `null` while loading, when skipped, or on failure. */
  readonly file: StigmerFile | null;
  /** True while the first read is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed read, or `null`. */
  readonly error: Error | null;
}

/**
 * Data hook that reads one File's record through `stigmer.file.get`: its
 * filename (`file.spec.filename`), media type (`file.spec.mimeType`) and
 * size (`file.status.sizeBytes`).
 *
 * @param fileId - The File's id (`"file_01j…"`), or `null` to skip.
 *
 * @example
 * ```tsx
 * const { file } = useFile(fileId);
 * return <span>{file?.spec?.filename ?? "file"}</span>;
 * ```
 */
export function useFile(fileId: string | null): UseFileReturn {
  const stigmer = useStigmer();
  const { data, isLoading, error } = useFetch<StigmerFile | null>(
    fileId ? () => stigmer.file.get(fileId) : null,
    [fileId, stigmer],
    null,
    { cacheKey: fileId ? `file:${fileId}` : undefined },
  );
  return useMemo(() => ({ file: data, isLoading, error }), [data, isLoading, error]);
}

/** Return value of {@link useFileDownloadUrl}. */
export interface UseFileDownloadUrlReturn {
  /** A link to the File's bytes, or `null` while minting, when skipped, or on failure. */
  readonly url: string | null;
  /** Error from the last failed attempt, or `null`. */
  readonly error: Error | null;
}

/**
 * Data hook that mints a link to a File's bytes through
 * `stigmer.file.getDownloadUrl`, for an `<img src>` preview.
 *
 * @param fileId - The File's id, or `null` to skip.
 * @param options.enabled - Mint only while true (default `true`).
 */
export function useFileDownloadUrl(
  fileId: string | null,
  options?: { readonly enabled?: boolean },
): UseFileDownloadUrlReturn {
  const stigmer = useStigmer();
  const active = (options?.enabled ?? true) && !!fileId;
  const { data, error } = useFetch<string | null>(
    active && fileId ? () => stigmer.file.getDownloadUrl(fileId).then((r) => r.url || null) : null,
    [fileId, active, stigmer],
    null,
    { cacheKey: active && fileId ? `file-url:${fileId}` : undefined },
  );
  return useMemo(() => ({ url: data, error }), [data, error]);
}

/** Return value of {@link useFileDownload}. */
export interface UseFileDownloadReturn {
  /**
   * Mint a fresh link to the File's bytes and save it in the browser,
   * suggesting `filename`. A no-op while a download is starting.
   */
  readonly download: (fileId: string, filename?: string) => Promise<void>;
  /** True while a link is being minted. */
  readonly isDownloading: boolean;
  /** Error from the last failed download, or `null`. */
  readonly error: Error | null;
}

/**
 * Behaviour hook that saves a File on click: the link is minted at click
 * time, since a link expires.
 *
 * @example
 * ```tsx
 * const { download, isDownloading } = useFileDownload();
 * <button onClick={() => download(fileId, "ledger.xlsx")} disabled={isDownloading}>
 *   Download
 * </button>
 * ```
 */
export function useFileDownload(): UseFileDownloadReturn {
  const stigmer = useStigmer();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(
    async (fileId: string, filename?: string) => {
      if (isDownloading) return;
      setIsDownloading(true);
      setError(null);
      try {
        const { url } = await stigmer.file.getDownloadUrl(fileId);
        if (url) triggerBrowserDownload(url, filename);
      } catch (err) {
        setError(toError(err));
      } finally {
        setIsDownloading(false);
      }
    },
    [stigmer, isDownloading],
  );

  return useMemo(() => ({ download, isDownloading, error }), [download, isDownloading, error]);
}
