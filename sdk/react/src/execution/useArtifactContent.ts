"use client";

import { create } from "@bufbuild/protobuf";
import { GetArtifactContentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
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
 * Data hook that fetches the text content of a single execution artifact
 * via `stigmer.agentExecution.getArtifactContent()`.
 *
 * The server reads the artifact from R2 and returns the bytes through the
 * Stigmer API, eliminating CORS concerns for SDK consumers who need to
 * read artifact content programmatically (YAML detection, preview
 * rendering, resource type identification).
 *
 * Pass `null` for either parameter to skip fetching — consistent with
 * the `useExecutionStream(null)` convention. The caller controls when
 * to fetch based on artifact metadata (e.g., only for text artifacts
 * below a size threshold):
 *
 * ```tsx
 * const shouldFetch = isTextArtifact(artifact) && Number(artifact.sizeBytes) < MAX_SIZE;
 * const { content } = useArtifactContent(
 *   shouldFetch ? executionId : null,
 *   shouldFetch ? artifact.storageKey : null,
 * );
 * ```
 *
 * For directory artifacts (ZIPs), pass `entryPath` to extract a specific
 * file from the archive instead of returning the raw ZIP bytes:
 *
 * ```tsx
 * const { content } = useArtifactContent(executionId, storageKey, "SKILL.md");
 * ```
 *
 * The server enforces a content size limit (default 512 KB). Content
 * exceeding this limit is truncated — check `isTruncated` and offer
 * a full download via the pre-signed URL for large artifacts.
 *
 * The returned `content` is decoded from UTF-8 bytes. For binary
 * artifacts, use `getArtifactDownloadUrl` instead of this hook.
 *
 * @param executionId - Execution that produced the artifact, or `null` to skip.
 * @param storageKey - Storage key from `ExecutionArtifact.storageKey`, or `null` to skip.
 * @param entryPath - For directory artifacts: relative path of a file within
 *   the archive to extract. `null` returns the full artifact (existing behavior).
 * @param contentHash - SHA-256 hex digest from `ExecutionArtifact.contentHash`.
 *   When the same file is overwritten during execution, the `storageKey` stays
 *   stable but `contentHash` changes, triggering a re-fetch so the UI never
 *   shows stale content. Pass `undefined` or omit for backwards compatibility.
 *
 * @example
 * ```tsx
 * function ArtifactViewer({ executionId, artifact }: {
 *   executionId: string;
 *   artifact: ExecutionArtifact;
 * }) {
 *   const shouldFetch = isTextArtifact(artifact)
 *     && Number(artifact.sizeBytes) < 512_000;
 *
 *   const { content, contentType, isTruncated, isLoading } = useArtifactContent(
 *     shouldFetch ? executionId : null,
 *     shouldFetch ? artifact.storageKey : null,
 *   );
 *
 *   if (isLoading) return <Skeleton />;
 *   if (!content) return null;
 *
 *   return (
 *     <ArtifactContentRenderer
 *       content={content}
 *       contentType={contentType}
 *       isTruncated={isTruncated}
 *     />
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Extract a single file from a directory artifact
 * const { content } = useArtifactContent(executionId, storageKey, "SKILL.md");
 * ```
 *
 * @see useExecutionArtifacts — extracts artifact metadata from an execution
 * @see isTextArtifact — heuristic for whether content is fetchable as text
 */
export function useArtifactContent(
  executionId: string | null,
  storageKey: string | null,
  entryPath?: string | null,
  contentHash?: string,
): UseArtifactContentReturn {
  const stigmer = useStigmer();

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    executionId && storageKey
      ? () =>
          stigmer.agentExecution
            .getArtifactContent(
              create(GetArtifactContentRequestSchema, {
                executionId,
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
