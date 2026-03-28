"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";

export interface UseExecutionArtifactsReturn {
  /** Artifacts published by the agent during execution. Ordered by creation time (oldest first). */
  readonly artifacts: readonly ExecutionArtifact[];
  /** `true` when the execution has at least one artifact. */
  readonly hasArtifacts: boolean;
  /** Total number of artifacts. */
  readonly artifactCount: number;
}

/**
 * Pure derivation hook that extracts artifact metadata from an
 * {@link AgentExecution} snapshot.
 *
 * Follows the same pattern as {@link useSessionUsage}: a `useMemo`-based
 * derivation with no side effects and no data fetching. The execution
 * object (typically from {@link useExecutionStream}) is the single input.
 *
 * Returns an empty array when the execution is `null` or has no artifacts,
 * eliminating null-checking at every consumer call site.
 *
 * For reading artifact *content* (e.g., for YAML detection or preview
 * rendering), compose with {@link useArtifactContent} on a per-artifact
 * basis. For determining whether an artifact is text-based, use
 * {@link isTextArtifact}.
 *
 * @example
 * ```tsx
 * const { execution } = useExecutionStream(executionId);
 * const { artifacts, hasArtifacts } = useExecutionArtifacts(execution);
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
export function useExecutionArtifacts(
  execution: AgentExecution | null,
): UseExecutionArtifactsReturn {
  return useMemo(() => {
    const artifacts = execution?.status?.artifacts ?? [];

    return {
      artifacts,
      hasArtifacts: artifacts.length > 0,
      artifactCount: artifacts.length,
    };
  }, [execution]);
}
