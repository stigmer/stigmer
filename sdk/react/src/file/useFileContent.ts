"use client";

/**
 * Data hook over one Stigmer File's text, read through the Stigmer API
 * (`stigmer.file.getContent`), for previews and the plan document.
 *
 * Trade-offs:
 * - The server caps a read (512 KB by default) and says when it cut the
 *   bytes, so a caller can offer the full download instead of a partial
 *   document.
 * - A File's bytes never change after upload, so a cache key by id is
 *   always safe: reopening a recently viewed File renders instantly.
 * - Bytes are decoded as UTF-8; a binary File is the caller's to skip
 *   (pass `null`) and download instead.
 */

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { GetFileContentInputSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";

interface FileContentData {
  readonly content: string | null;
  readonly isTruncated: boolean;
}

const EMPTY_CONTENT: FileContentData = { content: null, isTruncated: false };

/** Return value of {@link useFileContent}. */
export interface UseFileContentReturn {
  /** The File's text, or `null` while loading, when skipped, or on failure. */
  readonly content: string | null;
  /** Whether the server cut the bytes at its read cap. */
  readonly isTruncated: boolean;
  /** True while the first read is in flight. */
  readonly isLoading: boolean;
  /** True while a background re-read is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed read, or `null`. */
  readonly error: Error | null;
  /** Read the File again. */
  readonly refetch: () => void;
}

/**
 * Data hook that reads a File's text through `stigmer.file.getContent`.
 *
 * @param fileId - The File's id (`"file_01j…"`), or `null` to skip.
 *
 * @example
 * ```tsx
 * const { content, isLoading } = useFileContent(file.metadata?.id ?? null);
 * ```
 */
export function useFileContent(fileId: string | null): UseFileContentReturn {
  const stigmer = useStigmer();
  const { data, isLoading, isRefetching, error, refetch } = useFetch<FileContentData>(
    fileId
      ? () =>
          stigmer.file
            .getContent(create(GetFileContentInputSchema, { id: fileId }))
            .then((result) => ({
              content: new TextDecoder().decode(result.data),
              isTruncated: result.truncated,
            }))
      : null,
    [fileId, stigmer],
    EMPTY_CONTENT,
    { cacheKey: fileId ? `file-content:${fileId}` : undefined },
  );
  return useMemo(
    () => ({
      content: data.content,
      isTruncated: data.isTruncated,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [data, isLoading, isRefetching, error, refetch],
  );
}
