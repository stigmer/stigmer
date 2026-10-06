"use client";

import { useMemo } from "react";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/message_pb";
import { deriveRunFileChanges } from "../run/deriveRunFileChanges.js";

/** Return value of {@link useSessionFileChanges}. */
export interface UseSessionFileChangesReturn {
  /**
   * One {@link FileChange} per file touched in the session — the *net*
   * change for that path (see {@link deriveRunFileChanges} for the
   * net-diff semantics) — ordered for a file-list (modified, then
   * created/renamed, then deleted; alphabetical within each group).
   */
  readonly fileChanges: readonly FileChange[];
  /** `true` when at least one file was changed across all runs. */
  readonly hasFileChanges: boolean;
  /** Number of distinct files changed. */
  readonly fileChangeCount: number;
}

/**
 * Pure derivation hook that aggregates an agent's file changes across every
 * run in a session into one net change per file. A headless building
 * block for platform builders composing a consolidated session-changes surface
 * (typically paired with {@link FileChangesView}); the Console itself renders
 * file changes in the transcript (stamped edit rows + the per-turn decision
 * bar) and does not consume this hook.
 *
 * A thin memoizing wrapper over {@link deriveRunFileChanges} — the
 * shared execution-domain core that also powers the workflow panel's Changes
 * facet (`useWorkflowRunFileChanges`). The source (ledger-first via
 * `displayFileChangeSets`), the net-diff collapse, and the file-list ordering
 * are all documented on the core.
 *
 * @param runs - All runs for a session, in chronological order.
 *   Pass both completed and active-stream runs. Ordering matters: the
 *   net collapse anchors on each path's first and last change.
 *
 * @example
 * ```tsx
 * const allRuns = [
 *   ...conv.completedRuns,
 *   ...(conv.activeStreamRun ? [conv.activeStreamRun] : []),
 * ];
 * const { fileChanges, hasFileChanges } = useSessionFileChanges(allRuns);
 * ```
 *
 * @see useSessionWriteBacks — git-mode (PR) counterpart, which does drive the
 *   inspector's Changes tab
 * @see useFileChangeContent — resolves a change's before/after text for diffing
 * @see FileChangesView — component that renders this data
 */
export function useSessionFileChanges(
  executions: readonly AgentRun[],
): UseSessionFileChangesReturn {
  return useMemo(() => {
    const fileChanges = deriveRunFileChanges(executions);
    return {
      fileChanges,
      hasFileChanges: fileChanges.length > 0,
      fileChangeCount: fileChanges.length,
    };
  }, [executions]);
}
