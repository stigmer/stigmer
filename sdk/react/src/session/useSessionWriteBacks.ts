"use client";

import { useMemo } from "react";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/run/v1/writeback_pb";

/**
 * A single write-back entry enriched with the run it came from.
 *
 * The `executionId` links the write-back to its originating run
 * for traceability in the UI (e.g., tooltip or detail view).
 */
export interface SessionWriteBackEntry {
  /** The proto write-back record containing branch, PR URL, and commit details. */
  readonly writeBack: WorkspaceWriteBack;
  /** ID of the run that produced this write-back. */
  readonly runId: string;
}

/** Return value of {@link useSessionWriteBacks}. */
export interface UseSessionWriteBacksReturn {
  /** All write-backs from the session, ordered by workspace entry name. */
  readonly writeBacks: readonly SessionWriteBackEntry[];
  /** `true` when there is at least one write-back across all runs. */
  readonly hasWriteBacks: boolean;
  /** Total number of write-backs. */
  readonly writeBackCount: number;
}

/**
 * Pure derivation hook that aggregates workspace write-backs across all
 * runs in a session into a flat, deduplicated list.
 *
 * Follows the same pattern as {@link useSessionArtifacts}: `useMemo`-based
 * derivation, no side effects, no data fetching. Takes the same
 * `executions` array input.
 *
 * **Dedup semantics:** Write-backs are keyed by `workspace_entry_name`.
 * When multiple runs write back to the same workspace entry (e.g.,
 * a follow-up run on the same git repo), the latest run's
 * write-back wins — each run creates its own branch/PR, and the
 * most recent one is the one users care about.
 *
 * **Sorting:** Entries are sorted alphabetically by workspace entry name.
 *
 * @param runs - All runs for a session, in chronological
 *   order. Pass both completed and active-stream runs.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 * const allRuns = [
 *   ...conv.completedRuns,
 *   ...(conv.activeStreamRun ? [conv.activeStreamRun] : []),
 * ];
 * const { writeBacks, hasWriteBacks } = useSessionWriteBacks(allRuns);
 * ```
 *
 * @see useWorkspaceWriteBacks — single-execution write-back derivation
 * @see WriteBackCard — component that renders a single write-back
 */
export function useSessionWriteBacks(
  executions: readonly Run[],
): UseSessionWriteBacksReturn {
  return useMemo(() => {
    const entryMap = new Map<string, SessionWriteBackEntry>();

    for (const execution of executions) {
      const executionId = execution.metadata?.id ?? "";

      for (const wb of execution.status?.workspaceWriteBacks ?? []) {
        entryMap.set(wb.workspaceEntryName, {
          writeBack: wb,
          runId: executionId,
        });
      }
    }

    const entries = Array.from(entryMap.values());

    entries.sort((a, b) =>
      a.writeBack.workspaceEntryName.localeCompare(
        b.writeBack.workspaceEntryName,
        undefined,
        { sensitivity: "base" },
      ),
    );

    return {
      writeBacks: entries,
      hasWriteBacks: entries.length > 0,
      writeBackCount: entries.length,
    };
  }, [executions]);
}
