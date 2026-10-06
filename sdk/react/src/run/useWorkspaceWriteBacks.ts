"use client";

import { useMemo } from "react";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/writeback_pb";

/** Return value of {@link useWorkspaceWriteBacks}. */
export interface UseWorkspaceWriteBacksReturn {
  /** Write-back outcomes for git-backed workspace entries, ordered by workspace entry name. */
  readonly writeBacks: readonly WorkspaceWriteBack[];
  /** `true` when the run has at least one write-back entry. */
  readonly hasWriteBacks: boolean;
  /** Total number of write-back entries. */
  readonly writeBackCount: number;
}

/**
 * Pure derivation hook that extracts workspace write-back data from an
 * {@link AgentRun} snapshot.
 *
 * Follows the same `useMemo`-based derivation pattern as
 * {@link useRunArtifacts}: no side effects, no data fetching.
 * The run object (typically from {@link useRunStream}) is
 * the single input.
 *
 * Returns an empty array when the run is `null` or has no
 * write-backs, eliminating null-checking at every consumer call site.
 *
 * Each `WorkspaceWriteBack` entry corresponds to a git-backed workspace
 * entry where the platform detected file changes and ran the automatic
 * branch/commit/push/PR workflow.
 *
 * @example
 * ```tsx
 * const { run } = useRunStream(executionId);
 * const { writeBacks, hasWriteBacks } = useWorkspaceWriteBacks(run);
 *
 * if (hasWriteBacks) {
 *   writeBacks.forEach((wb) => console.log(wb.workspaceEntryName, wb.pullRequestUrl));
 * }
 * ```
 *
 * @see useRunArtifacts — similar derivation hook for artifacts
 */
export function useWorkspaceWriteBacks(
  execution: AgentRun | null,
): UseWorkspaceWriteBacksReturn {
  return useMemo(() => {
    const writeBacks = execution?.status?.workspaceWriteBacks ?? [];

    return {
      writeBacks,
      hasWriteBacks: writeBacks.length > 0,
      writeBackCount: writeBacks.length,
    };
  }, [execution]);
}
