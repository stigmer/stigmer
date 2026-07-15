"use client";

// Behavior hook that downloads an Artifact resource on demand.
// Domain: workflow (the Artifact-resource counterpart of useArtifactDownload).

import { useCallback, useMemo, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useWorkflowArtifactDownload}. */
export interface UseWorkflowArtifactDownloadReturn {
  /**
   * Mint a fresh download URL for the artifact and open it. No-op when the
   * id is empty or a download is already in flight. Resolves once the
   * download has been initiated.
   *
   * @param artifactId - The `Artifact` resource id (`art_…`).
   */
  readonly download: (artifactId: string) => Promise<void>;
  /** `true` while a URL is being minted / the download is being initiated. */
  readonly isDownloading: boolean;
  /** Error from the last failed download attempt, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that downloads an `Artifact` resource on demand via
 * `stigmer.artifact.getDownloadUrl(id)` — mint-at-click-time so the
 * (short-TTL, presigned in Cloud) URL is always valid.
 *
 * Mirrors {@link useArtifactDownload}, which serves the session's
 * `ExecutionArtifact` model (addressed by `executionId` + `storageKey`);
 * this one serves the workflow's first-class `Artifact` resource (addressed
 * by artifact id). The two models are deliberately unified only at the
 * presentational layer, so each keeps its own download mechanics.
 */
export function useWorkflowArtifactDownload(): UseWorkflowArtifactDownloadReturn {
  const stigmer = useStigmer();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(
    async (artifactId: string) => {
      if (!artifactId || isDownloading) return;
      setIsDownloading(true);
      setError(null);
      try {
        const result = await stigmer.artifact.getDownloadUrl(artifactId);
        if (result.url) {
          // New tab rather than an anchor download: the URL's disposition is
          // owned by the server (presigned in Cloud), and the `download`
          // attribute is ignored cross-origin anyway.
          window.open(result.url, "_blank", "noopener,noreferrer");
        }
      } catch (err) {
        setError(toError(err));
      } finally {
        setIsDownloading(false);
      }
    },
    [stigmer, isDownloading],
  );

  return useMemo(
    () => ({ download, isDownloading, error }),
    [download, isDownloading, error],
  );
}
