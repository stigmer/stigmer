"use client";

import { useMemo } from "react";
import type { ToolCallOutputRef } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { useArtifactContent } from "./useArtifactContent";
import { execIdFromStorageKey } from "./useFileChangeContent";

/** Return value of {@link useToolOutputContent}. */
export interface UseToolOutputContentReturn {
  /**
   * Full text content of the offloaded tool output, or `null` while the
   * request is in-flight, failed, or the hook is disabled.
   */
  readonly content: string | null;
  /** `true` while the content request is in-flight. */
  readonly isLoading: boolean;
  /**
   * `true` when the server truncated the content at its size cap. The inline
   * view is then incomplete — offer a full download via the presigned URL.
   */
  readonly isTruncated: boolean;
  /** Error from a failed fetch, or `null`. */
  readonly error: Error | null;
}

/**
 * Minimal shape this hook needs from an offloaded-output reference. Both a full
 * {@link ToolCallOutputRef} and the SDK's normalized `outputRef` view satisfy it.
 */
export type ToolOutputRefLike = Pick<ToolCallOutputRef, "storageKey" | "contentHash">;

/**
 * Behavior hook that resolves the full text of a tool output that the runner
 * offloaded to artifact storage (a {@link ToolCallOutputRef}).
 *
 * Mirrors {@link useFileChangeContent}: it ignores any URL baked into the ref
 * and fetches the bytes on demand through the CORS-safe `getArtifactContent`
 * endpoint, deriving the execution id from the ref's own `storageKey`
 * (`artifacts/{executionId}/...`). This is what lets a "View full output" link
 * keep working long after the original presigned URL would have expired.
 *
 * Fetching is gated by `enabled` so callers can defer the request until the
 * user actually expands the output (lazy), keeping long threads cheap.
 *
 * @param outputRef - The offloaded-output reference, or `null` to skip.
 * @param enabled - When `false`, the hook stays idle. Defaults to `true`.
 *
 * @see useArtifactContent — the underlying content fetch
 * @see useArtifactDownloadUrl — for the truncated/binary full-download fallback
 */
export function useToolOutputContent(
  outputRef: ToolOutputRefLike | null | undefined,
  enabled = true,
): UseToolOutputContentReturn {
  const storageKey = outputRef?.storageKey || null;
  const active = enabled && !!storageKey;
  const executionId = active ? execIdFromStorageKey(storageKey!) : null;

  const { content, isLoading, isTruncated, error } = useArtifactContent(
    active ? executionId : null,
    active ? storageKey : null,
    null,
    outputRef?.contentHash || undefined,
  );

  return useMemo(
    () => ({ content, isLoading, isTruncated, error }),
    [content, isLoading, isTruncated, error],
  );
}
