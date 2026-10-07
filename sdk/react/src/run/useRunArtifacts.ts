"use client";

import { useMemo } from "react";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { RunArtifact } from "@stigmer/protos/ai/stigmer/agentic/run/v1/artifact_pb";

/** Return value of {@link useRunArtifacts}. */
export interface UseRunArtifactsReturn {
  /** Artifacts published by the agent during run. Ordered by creation time (oldest first). */
  readonly artifacts: readonly RunArtifact[];
  /** `true` when the run has at least one artifact. */
  readonly hasArtifacts: boolean;
  /** Total number of artifacts. */
  readonly artifactCount: number;
}

/**
 * Pure derivation hook that extracts artifact metadata from an
 * {@link Run} snapshot.
 *
 * Follows the same pattern as {@link useSessionUsage}: a `useMemo`-based
 * derivation with no side effects and no data fetching. The run
 * object (typically from {@link useRunStream}) is the single input.
 *
 * Returns an empty array when the run is `null` or has no artifacts,
 * eliminating null-checking at every consumer call site.
 *
 * For reading artifact *content* (e.g., for YAML detection or preview
 * rendering), compose with {@link useArtifactContent} on a per-artifact
 * basis. For determining whether an artifact is text-based, use
 * {@link isTextArtifact}.
 *
 * @example
 * ```tsx
 * const { run } = useRunStream(executionId);
 * const { artifacts, hasArtifacts } = useRunArtifacts(run);
 *
 * if (hasArtifacts) {
 *   artifacts.forEach((a) => console.log(a.name, a.sizeBytes));
 * }
 * ```
 *
 * @see useArtifactContent — content-fetching hook for a single artifact
 * @see isTextArtifact — heuristic for fetchable text content
 * @see formatArtifactSize — human-readable file size formatting
 */
export function useRunArtifacts(
  execution: Run | null,
): UseRunArtifactsReturn {
  return useMemo(() => {
    const artifacts = execution?.status?.artifacts ?? [];

    return {
      artifacts,
      hasArtifacts: artifacts.length > 0,
      artifactCount: artifacts.length,
    };
  }, [execution]);
}
