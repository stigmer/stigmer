"use client";

import { useMemo } from "react";
import {
  detectStigmerResource,
  type StigmerResourceDetection,
} from "./detect-stigmer-resource.js";

const NOT_DETECTED: StigmerResourceDetection = { detected: false } as const;

/**
 * Detects whether a YAML content string represents a Stigmer platform resource.
 *
 * Thin React wrapper around {@link detectStigmerResource}. The result is
 * memoized — detection only re-runs when `content` changes by reference.
 *
 * Pass `null` to skip detection (returns `{ detected: false }`). This
 * makes the hook safe to call unconditionally even while content is
 * still loading via {@link useArtifactContent}.
 *
 * @param content - Raw YAML content string, or `null` to skip detection.
 * @returns A discriminated union: `{ detected: true, kind, ... }` when a
 *   recognized Stigmer resource is found, `{ detected: false }` otherwise.
 *
 * @example
 * ```tsx
 * const { content } = useArtifactContent(executionId, storageKey);
 * const detection = useDetectStigmerResource(content);
 *
 * if (detection.detected) {
 *   return <Badge>{detection.displayName}</Badge>;
 * }
 * ```
 *
 * @see {@link detectStigmerResource} for the pure function (non-React usage)
 * @see {@link useArtifactContent} for fetching artifact content
 */
export function useDetectStigmerResource(
  content: string | null,
): StigmerResourceDetection {
  return useMemo(
    () => (content === null ? NOT_DETECTED : detectStigmerResource(content)),
    [content],
  );
}
