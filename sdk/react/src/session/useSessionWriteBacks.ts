"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";

/**
 * A single write-back entry enriched with the execution context that
 * produced it.
 *
 * The `executionId` links the write-back to its originating execution
 * for traceability in the UI (e.g., tooltip or detail view).
 */
export interface SessionWriteBackEntry {
  /** The proto write-back record containing branch, PR URL, and commit details. */
  readonly writeBack: WorkspaceWriteBack;
  /** ID of the execution that produced this write-back. */
  readonly executionId: string;
}

/** Return value of {@link useSessionWriteBacks}. */
export interface UseSessionWriteBacksReturn {
  /** All write-backs from the session, ordered by workspace entry name. */
  readonly writeBacks: readonly SessionWriteBackEntry[];
  /** `true` when there is at least one write-back across all executions. */
  readonly hasWriteBacks: boolean;
  /** Total number of write-backs. */
  readonly writeBackCount: number;
}

/**
 * Pure derivation hook that aggregates workspace write-backs across all
 * executions in a session into a flat, deduplicated list.
 *
 * Follows the same pattern as {@link useSessionArtifacts}: `useMemo`-based
 * derivation, no side effects, no data fetching. Takes the same
 * `executions` array input.
 *
 * **Dedup semantics:** Write-backs are keyed by `workspace_entry_name`.
 * When multiple executions write back to the same workspace entry (e.g.,
 * a follow-up execution on the same git repo), the latest execution's
 * write-back wins — each execution creates its own branch/PR, and the
 * most recent one is the one users care about.
 *
 * **Sorting:** Entries are sorted alphabetically by workspace entry name.
 *
 * @param executions - All executions for a session, in chronological
 *   order. Pass both completed and active-stream executions.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 * const allExecutions = [
 *   ...conv.completedExecutions,
 *   ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
 * ];
 * const { writeBacks, hasWriteBacks } = useSessionWriteBacks(allExecutions);
 * ```
 *
 * @see useWorkspaceWriteBacks — single-execution write-back derivation
 * @see WriteBackCard — component that renders a single write-back
 */
export function useSessionWriteBacks(
  executions: readonly AgentExecution[],
): UseSessionWriteBacksReturn {
  return useMemo(() => {
    const entryMap = new Map<string, SessionWriteBackEntry>();

    for (const execution of executions) {
      const executionId = execution.metadata?.id ?? "";

      for (const wb of execution.status?.workspaceWriteBacks ?? []) {
        entryMap.set(wb.workspaceEntryName, {
          writeBack: wb,
          executionId,
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
