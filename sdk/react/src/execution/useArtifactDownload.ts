"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { GetArtifactDownloadUrlRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useArtifactDownload}. */
export interface UseArtifactDownloadReturn {
  /**
   * Mint a fresh presigned URL for `storageKey` and trigger a browser
   * download. No-op when the execution id is unknown or a download is already
   * in flight. Resolves once the download has been initiated.
   *
   * @param storageKey - Storage key of the artifact to download.
   * @param fileName - Optional suggested file name for the saved file.
   */
  readonly download: (storageKey: string, fileName?: string) => Promise<void>;

  /** `true` while a URL is being minted / the download is being initiated. */
  readonly isDownloading: boolean;

  /** Error from the last failed download attempt, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that downloads an execution artifact on demand.
 *
 * Mirrors the click → mint fresh URL → browser download flow established by
 * `WorkflowExecutionArtifactPanel`, generalized so every artifact "Download"
 * affordance shares one implementation. The URL is minted at click time from
 * the stable `storageKey` via `getArtifactDownloadUrl`, so it is always valid —
 * unlike the previously persisted, short-lived URL that expired after an hour.
 *
 * Returns an imperative `download(storageKey, fileName?)` action rather than a
 * URL, because a download is a user action, not render data. For rendering an
 * image or showing a link, use {@link useArtifactDownloadUrl} instead.
 *
 * @param executionId - Execution that produced the artifacts, or `null` to
 *   disable (the action becomes a no-op).
 *
 * @example
 * ```tsx
 * const { download, isDownloading } = useArtifactDownload(executionId);
 * <button onClick={() => download(artifact.storageKey, artifact.name)} disabled={isDownloading}>
 *   Download
 * </button>
 * ```
 *
 * @see useArtifactDownloadUrl — declarative URL resolver (image src, links)
 */
export function useArtifactDownload(
  executionId: string | null,
): UseArtifactDownloadReturn {
  const stigmer = useStigmer();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(
    async (storageKey: string, fileName?: string) => {
      if (!executionId || !storageKey || isDownloading) return;
      setIsDownloading(true);
      setError(null);
      try {
        const result = await stigmer.agentExecution.getArtifactDownloadUrl(
          create(GetArtifactDownloadUrlRequestSchema, { executionId, storageKey }),
        );
        if (result.downloadUrl) {
          triggerBrowserDownload(result.downloadUrl, fileName);
        }
      } catch (err) {
        setError(toError(err));
      } finally {
        setIsDownloading(false);
      }
    },
    [executionId, stigmer, isDownloading],
  );

  return useMemo(
    () => ({ download, isDownloading, error }),
    [download, isDownloading, error],
  );
}

/**
 * Trigger a browser download for a URL via a transient anchor click. The
 * `download` hint is best-effort: browsers ignore it for cross-origin URLs
 * (e.g. R2), in which case the navigation still serves the file. Falls back to
 * a new tab in non-DOM environments.
 */
function triggerBrowserDownload(url: string, fileName?: string): void {
  if (typeof document === "undefined") {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  if (fileName) anchor.download = fileName;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
