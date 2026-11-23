"use client";

// Every file a conversation's turns changed, one net change per path: the
// data a side list of the conversation's changes reads. A memoizing wrapper
// over `deriveRunFileChanges`, which holds the net-change rules.

import { useMemo } from "react";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { DisplayFileChange } from "@stigmer/client";
import { deriveRunFileChanges } from "../run/deriveRunFileChanges.js";

/** Return value of {@link useSessionFileChanges}. */
export interface UseSessionFileChangesReturn {
  /**
   * One {@link DisplayFileChange} per file touched in the session — the *net*
   * change for that path (see {@link deriveRunFileChanges} for the
   * net-diff semantics) — ordered for a file-list (modified, then
   * created/renamed, then deleted; alphabetical within each group).
   */
  readonly fileChanges: readonly DisplayFileChange[];
  /** `true` when at least one file was changed across all runs. */
  readonly hasFileChanges: boolean;
  /** Number of distinct files changed. */
  readonly fileChangeCount: number;
}

/**
 * Pure derivation hook that aggregates an agent's file changes across every
 * run in a session into one net change per file. A headless building
 * block for a consolidated session-changes surface (a side list of every
 * file the conversation touched; the React kit draws one as its file
 * changes view); the Console itself renders file changes in the transcript
 * (stamped edit rows + the per-turn decision bar) and does not consume this
 * hook.
 *
 * A thin memoizing wrapper over {@link deriveRunFileChanges} — the
 * execution-domain core. The source (each run's file record, via
 * `displayFileChangeSets`), the net-diff collapse, and the file-list ordering
 * are all documented on the core.
 *
 * @param executions - All runs for a session, in chronological order.
 *   Pass both completed and active-stream runs. Ordering matters: the
 *   net collapse anchors on each path's first and last change.
 *
 * @example
 * ```tsx
 * function ChangedFileCount({ sessionId, org }: { sessionId: string; org: string }) {
 *   const conv = useSessionConversation(sessionId, org);
 *   const { fileChangeCount, hasFileChanges } = useSessionFileChanges(conv.runs);
 *   return hasFileChanges ? <span>{fileChangeCount} files changed</span> : null;
 * }
 * ```
 *
 * @see useFileChangeContent — resolves a change's before/after text for diffing
 */
export function useSessionFileChanges(
  executions: readonly Run[],
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
