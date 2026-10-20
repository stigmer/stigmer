"use client";

import { create } from "@bufbuild/protobuf";
import { GetArtifactContentRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

interface ArtifactContentData {
  content: string | null;
  contentType: string | null;
  isTruncated: boolean;
}

const EMPTY_ARTIFACT: ArtifactContentData = {
  content: null,
  contentType: null,
  isTruncated: false,
};

/** Return value of {@link useArtifactContent}. */
export interface UseArtifactContentReturn {
  /**
   * Decoded text content of the artifact, or `null` when:
   * - Fetching is skipped (`executionId` or `storageKey` is `null`)
   * - The request is in-flight
   * - The request failed
   */
  readonly content: string | null;

  /**
   * Detected content type (e.g., `"text/yaml"`, `"text/plain"`).
   * `null` before the first successful fetch.
   */
  readonly contentType: string | null;

  /**
   * Whether the returned content was truncated by the server's
   * `max_bytes` limit. When `true`, the full artifact should be
   * downloaded via `getArtifactDownloadUrl` instead.
   */
  readonly isTruncated: boolean;

  /** `true` while the content request is in-flight. */
  readonly isLoading: boolean;

  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;

  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;

  /**
   * Re-fetch the artifact content. Uses the `fetchKey` counter pattern
   * consistent with `refetch()` in other SDK hooks.
   */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the text content stored under a run's storage key
 * via `stigmer.run.getArtifactContent()`: a tool call's offloaded output, or
 * one side of a captured file change too large to keep inline. A File the
 * agent saved for the person is read with `useFileContent` instead.
 *
 * The server reads the bytes from storage and returns them through the
 * Stigmer API, so a browser never reads storage cross-origin.
 *
 * Pass `null` for either parameter to skip fetching.
 *
 * The server enforces a content size limit (default 512 KB). Content
 * exceeding this limit is truncated — check `isTruncated` and offer a full
 * download via {@link useArtifactDownloadUrl}.
 *
 * @param executionId - Run whose storage key it is, or `null` to skip.
 * @param storageKey - Storage key from a `ToolCallOutputRef`, or `null` to skip.
 * @param entryPath - For a ZIP stored under the key: relative path of a file
 *   within the archive to extract. `null` returns the stored bytes.
 * @param contentHash - Digest of the stored bytes. When the same key is
 *   overwritten, the hash changes and triggers a re-fetch so the UI never
 *   shows stale content.
 * @param cacheKey - Optional cross-mount cache key. When set, a remount
 *   with the same key renders the previously-fetched content instantly and
 *   refetches in the background (no skeleton flash).
 *
 * @example
 * ```tsx
 * const { content, isLoading } = useArtifactContent(executionId, outputRef.storageKey);
 * ```
 *
 * @see useToolOutputContent — the tool-output reader built on this hook
 */
export function useArtifactContent(
  executionId: string | null,
  storageKey: string | null,
  entryPath?: string | null,
  contentHash?: string,
  cacheKey?: string,
): UseArtifactContentReturn {
  const stigmer = useStigmer();

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    executionId && storageKey
      ? () =>
          stigmer.run
            .getArtifactContent(
              create(GetArtifactContentRequestSchema, {
                runId: executionId,
                storageKey,
                ...(entryPath ? { entryPath } : {}),
              }),
            )
            .then((result): ArtifactContentData => ({
              content: new TextDecoder().decode(result.content),
              contentType: result.contentType || null,
              isTruncated: result.truncated,
            }))
      : null,
    [executionId, storageKey, entryPath, contentHash, stigmer],
    EMPTY_ARTIFACT,
    cacheKey ? { cacheKey } : undefined,
  );

  return {
    content: data.content,
    contentType: data.contentType,
    isTruncated: data.isTruncated,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
