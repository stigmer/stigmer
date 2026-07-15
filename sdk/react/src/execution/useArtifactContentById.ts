"use client";

// Data hook that reads an Artifact resource's content by artifact id.
// Domain: execution (the Artifact-resource counterpart of useArtifactContent).

import { create } from "@bufbuild/protobuf";
import { GetArtifactContentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

interface ArtifactContentData {
  content: string | null;
  contentType: string | null;
  totalSizeBytes: bigint;
  isTruncated: boolean;
}

const EMPTY_ARTIFACT: ArtifactContentData = {
  content: null,
  contentType: null,
  totalSizeBytes: BigInt(0),
  isTruncated: false,
};

/** Return value of {@link useArtifactContentById}. */
export interface UseArtifactContentByIdReturn {
  /**
   * Decoded text content of the artifact, or `null` when:
   * - Fetching is skipped (`artifactId` is `null`)
   * - The request is in-flight
   * - The request failed
   */
  readonly content: string | null;
  /**
   * MIME content type recorded at artifact creation
   * (`ArtifactSpec.content_type`). `null` before the first successful fetch.
   */
  readonly contentType: string | null;
  /**
   * Actual total size of the artifact in bytes — larger than the returned
   * content when `isTruncated` is `true` ("showing 512 KB of 2.1 MB").
   */
  readonly totalSizeBytes: bigint;
  /**
   * Whether the returned content was truncated by the server's `max_bytes`
   * limit. When `true`, offer the full artifact via `getDownloadUrl` instead.
   */
  readonly isTruncated: boolean;
  /** `true` while the content request is in-flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the artifact content. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the text content of an `Artifact` resource via
 * `stigmer.artifact.getContent()`.
 *
 * The server proxies the artifact bytes through the Stigmer API rather than
 * handing out a presigned URL — embedded SDK consumers on third-party origins
 * avoid the CORS exposure of fetching storage URLs from the browser (the same
 * rationale as the agent-execution side's `useArtifactContent`, which this
 * hook mirrors; artifacts here are addressed by artifact ID, the artifact
 * store's identity, instead of `executionId` + `storageKey`).
 *
 * Pass `null` for `artifactId` to skip fetching — the caller controls when to
 * fetch based on artifact metadata (e.g. only for text content types below a
 * size threshold), consistent with the `useArtifactContent(null)` convention.
 *
 * The server enforces a content size limit (default 512 KB). Content
 * exceeding it comes back with `isTruncated: true`; offer a full download via
 * `getDownloadUrl` in that case. The returned `content` is decoded as UTF-8 —
 * for binary artifacts, use `getDownloadUrl` instead of this hook.
 *
 * @param artifactId - The `Artifact` resource id (`art_…`), or `null` to skip.
 * @param cacheKey - Optional cross-mount cache key (DD-014). When set, a
 *   remount with the same key renders previously-fetched content instantly
 *   and refetches in the background — used by the workflow artifact document
 *   so switching back to a recently-viewed tab is instant.
 */
export function useArtifactContentById(
  artifactId: string | null,
  cacheKey?: string,
): UseArtifactContentByIdReturn {
  const stigmer = useStigmer();

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    artifactId
      ? () =>
          stigmer.artifact
            .getContent(
              create(GetArtifactContentRequestSchema, { artifactId }),
            )
            .then((result): ArtifactContentData => ({
              content: new TextDecoder().decode(result.content),
              contentType: result.contentType || null,
              totalSizeBytes: result.totalSizeBytes,
              isTruncated: result.truncated,
            }))
      : null,
    [artifactId, stigmer],
    EMPTY_ARTIFACT,
    cacheKey ? { cacheKey } : undefined,
  );

  return {
    content: data.content,
    contentType: data.contentType,
    totalSizeBytes: data.totalSizeBytes,
    isTruncated: data.isTruncated,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
