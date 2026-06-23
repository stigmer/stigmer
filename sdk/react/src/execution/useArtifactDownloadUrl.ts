"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { GetArtifactDownloadUrlRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

/** Return value of {@link useArtifactDownloadUrl}. */
export interface UseArtifactDownloadUrlReturn {
  /**
   * A freshly minted presigned download URL for the artifact, or `null` when:
   * - Fetching is skipped (`enabled` is `false`, or `executionId`/`storageKey` is `null`)
   * - The request is in-flight
   * - The request failed
   */
  readonly url: string | null;

  /** `true` while the URL request is in-flight (first load). */
  readonly isLoading: boolean;

  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;

  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;

  /** Re-fetch the URL (e.g. to mint a fresh one after the previous expired). */
  readonly refetch: () => void;
}

interface UrlData {
  readonly url: string | null;
}

const EMPTY: UrlData = { url: null };

/** Options for {@link useArtifactDownloadUrl}. */
export interface UseArtifactDownloadUrlOptions {
  /**
   * Gate the request. When `false`, the hook stays idle and returns `null` —
   * use this to defer minting a URL until it is actually needed (e.g. only
   * when an image becomes visible, or after a truncation is detected).
   * Defaults to `true`.
   */
  readonly enabled?: boolean;
}

/**
 * Data hook that resolves a **fresh** presigned download URL for an execution
 * artifact on demand via `stigmer.agentExecution.getArtifactDownloadUrl()`.
 *
 * This exists because presigned URLs expire. The runner once baked a
 * short-lived URL into the persisted execution status and the UI rendered it
 * verbatim — so any link opened after the URL's lifetime failed with
 * `ExpiredRequest`. Minting the URL at view time from the stable `storageKey`
 * guarantees it is always valid, and works for every historical execution
 * (the `storageKey` never expires).
 *
 * Use this for surfaces that genuinely need a URL — an `<img src>` for an
 * offloaded screenshot, or a direct browser download of a large/binary
 * artifact. For text that should render in-app, prefer {@link useArtifactContent}
 * (CORS-safe, no presign).
 *
 * The URL is cached cross-mount by `storageKey` (DD-014), so repeated renders
 * and remounts reuse the same minted URL instead of re-hitting the API.
 *
 * Pass `enabled: false` (or `null` for either id) to skip fetching — consistent
 * with the `useArtifactContent(null, null)` convention.
 *
 * @param executionId - Execution that produced the artifact, or `null` to skip.
 * @param storageKey - Storage key from the artifact/output ref, or `null` to skip.
 * @param options - Optional gating (`enabled`).
 *
 * @example
 * ```tsx
 * // Render an offloaded screenshot with an always-fresh URL.
 * const { url, isLoading } = useArtifactDownloadUrl(executionId, storageKey);
 * if (isLoading) return <Skeleton />;
 * return url ? <img src={url} alt="Tool output" /> : null;
 * ```
 *
 * @see useArtifactContent — reads artifact bytes through the API (text preview)
 * @see useArtifactDownload — imperative click-to-download counterpart
 */
export function useArtifactDownloadUrl(
  executionId: string | null,
  storageKey: string | null,
  options?: UseArtifactDownloadUrlOptions,
): UseArtifactDownloadUrlReturn {
  const stigmer = useStigmer();
  const enabled = options?.enabled ?? true;
  const active = enabled && !!executionId && !!storageKey;

  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    active
      ? () =>
          stigmer.agentExecution
            .getArtifactDownloadUrl(
              create(GetArtifactDownloadUrlRequestSchema, {
                executionId: executionId!,
                storageKey: storageKey!,
              }),
            )
            .then((result): UrlData => ({ url: result.downloadUrl || null }))
      : null,
    [executionId, storageKey, active, stigmer],
    EMPTY,
    { cacheKey: storageKey ? `artifact-url:${storageKey}` : undefined },
  );

  return useMemo(
    () => ({ url: data.url, isLoading, isRefetching, error, refetch }),
    [data.url, isLoading, isRefetching, error, refetch],
  );
}
