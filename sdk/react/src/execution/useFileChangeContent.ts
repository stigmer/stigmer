"use client";

import { useMemo } from "react";
import type {
  FileChange,
  FileContent,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { useArtifactContent } from "./useArtifactContent.js";
import { useArtifactDownloadUrl } from "./useArtifactDownloadUrl.js";

/** Return value of {@link useFileChangeContent}. */
export interface UseFileChangeContentReturn {
  /**
   * Before-side text for diffing. `""` for an absent side (e.g. CREATE has no
   * before). `null` while an offloaded side is in-flight or failed to load.
   */
  readonly beforeText: string | null;
  /**
   * After-side text for diffing. `""` for an absent side (e.g. DELETE has no
   * after). `null` while an offloaded side is in-flight or failed to load.
   */
  readonly afterText: string | null;
  /** `true` when either side is binary — render "binary file changed", not a diff. */
  readonly isBinary: boolean;
  /** `true` while an offloaded side's content request is in flight. */
  readonly isLoading: boolean;
  /** Error from a failed offloaded-side fetch, or `null`. */
  readonly error: Error | null;
  /**
   * `true` when an offloaded side exceeded the server's content-size limit and
   * was truncated — the inline diff would be incomplete; offer {@link downloadUrl}.
   */
  readonly isTruncated: boolean;
  /**
   * Direct download URL for an offloaded side (the after side preferred), used
   * as the fallback when content is truncated. `null` when neither side is offloaded.
   */
  readonly downloadUrl: string | null;
}

/**
 * Behavior hook that resolves a {@link FileChange}'s before/after sides to the
 * text the diff renderer needs.
 *
 * Small bodies are carried inline on the proto and returned with zero cost.
 * Large bodies were offloaded to artifact storage by the runner
 * (`FileContent.ref`); this hook lazily fetches them via
 * {@link useArtifactContent} through the server proxy (CORS-safe). The fetch's
 * `executionId` is derived from the ref's own `storageKey`
 * (`artifacts/{executionId}/...`), so a net diff whose two sides originated in
 * different executions still resolves each side correctly.
 *
 * This is the single place offload refs are dereferenced — the SDK's
 * `tool-view` deliberately stays fetch-free, deferring all ref handling here.
 *
 * Rules-of-hooks safe: both sides always issue a (possibly skipped)
 * `useArtifactContent` call; inline/absent sides pass `null` and never fetch.
 *
 * @param change - The file change whose content to resolve.
 *
 * @see useSessionFileChanges — produces the changes this resolves
 * @see FileChangeDiff — renders the resolved content
 */
export function useFileChangeContent(
  change: FileChange,
): UseFileChangeContentReturn {
  const beforeRef = refOf(change.before);
  const afterRef = refOf(change.after);

  const beforeFetch = useArtifactContent(
    beforeRef ? execIdFromStorageKey(beforeRef.storageKey) : null,
    beforeRef ? beforeRef.storageKey : null,
    null,
    beforeRef?.contentHash,
  );
  const afterFetch = useArtifactContent(
    afterRef ? execIdFromStorageKey(afterRef.storageKey) : null,
    afterRef ? afterRef.storageKey : null,
    null,
    afterRef?.contentHash,
  );

  // The download fallback is needed only when an offloaded side was truncated.
  // Resolve a fresh URL on demand from the stable storageKey (after side
  // preferred), gated on truncation so we don't mint a URL we won't use.
  const isTruncated = beforeFetch.isTruncated || afterFetch.isTruncated;
  const downloadRef = afterRef ?? beforeRef;
  const { url: downloadUrl } = useArtifactDownloadUrl(
    downloadRef ? execIdFromStorageKey(downloadRef.storageKey) : null,
    downloadRef ? downloadRef.storageKey : null,
    { enabled: isTruncated },
  );

  return useMemo(
    () => ({
      beforeText: sideText(change.before, beforeFetch.content),
      afterText: sideText(change.after, afterFetch.content),
      isBinary: Boolean(change.before?.isBinary || change.after?.isBinary),
      isLoading: beforeFetch.isLoading || afterFetch.isLoading,
      error: beforeFetch.error ?? afterFetch.error,
      isTruncated,
      downloadUrl,
    }),
    [
      change.before,
      change.after,
      beforeFetch.content,
      afterFetch.content,
      beforeFetch.isLoading,
      afterFetch.isLoading,
      beforeFetch.error,
      afterFetch.error,
      isTruncated,
      downloadUrl,
    ],
  );
}

/** The offload pointer of a side, or null when the side is absent/inline/binary. */
function refOf(side: FileContent | undefined) {
  if (!side || side.isBinary) return null;
  return side.body.case === "ref" ? side.body.value : null;
}

/**
 * Resolves one side to text: absent → "" (empty file), inline → its value,
 * offloaded → the fetched content (`null` until it loads).
 */
function sideText(
  side: FileContent | undefined,
  fetched: string | null,
): string | null {
  if (!side || side.isBinary) return "";
  if (side.body.case === "inline") return side.body.value;
  return fetched;
}

/**
 * Extracts the execution id from an artifact storage key of the form
 * `artifacts/{executionId}/...`. Returns `null` for an unexpected shape so the
 * caller skips the fetch rather than issuing a request the server would reject.
 */
export function execIdFromStorageKey(storageKey: string): string | null {
  const parts = storageKey.split("/");
  if (parts.length >= 3 && parts[0] === "artifacts" && parts[1]) {
    return parts[1];
  }
  return null;
}
