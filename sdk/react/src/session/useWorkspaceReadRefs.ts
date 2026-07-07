"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { WorkspaceEntry } from "../workspace/useWorkspaceEntries.js";

/**
 * Pure derivation hook that projects the session's workspace write-backs onto
 * its workspace entries as per-entry read refs.
 *
 * The agent's file changes land on a write-back branch (`stigmer/<id>`), not
 * the branch the session was configured with — so read-side surfaces (file
 * viewer, tree listing, name search) pointed at the configured branch would
 * 404 on agent-created files and silently show stale content for modified
 * ones. This hook returns the entries with `readRef` set to the latest
 * write-back commit SHA, which those surfaces resolve in preference to
 * `gitBranch`. A commit SHA (not the branch name) so reads are immutable-ref
 * exact, immune to branch eventual-consistency.
 *
 * **Ref selection:** the latest write-back with a non-empty `commitSha` wins
 * per workspace entry, across all executions in chronological order. FAILED
 * write-back records carry no SHA and never regress the ref.
 *
 * **Entry matching** mirrors the runner's `WriteBackCoordinator.resolveEntry`:
 * single-entry sessions provision with an empty `workspaceEntryName`, so when
 * the session has exactly one git entry every write-back applies to it;
 * multi-entry sessions match strictly by name.
 *
 * **Reference stability (DD-010):** the decorated array is memoized on the
 * entries array and a value signature of the derived refs — streaming frames
 * that don't change any write-back SHA return the identical array, so
 * downstream listing/content effects never churn.
 *
 * @param executions - All executions for the session, in chronological order
 *   (same input contract as {@link useSessionWriteBacks}).
 * @param entries - The session's workspace entries. Returned as-is (same
 *   reference) when no entry derives a ref.
 *
 * @example
 * ```tsx
 * const surfaceEntries = useWorkspaceReadRefs(flow.allExecutions, flow.workspace.entries);
 * <WorkspaceSurface entries={surfaceEntries} ... />
 * ```
 *
 * @see useSessionWriteBacks — the write-back list this projection derives from
 * @see WorkspaceEntry.readRef — the field this hook populates
 */
export function useWorkspaceReadRefs(
  executions: readonly AgentExecution[],
  entries: readonly WorkspaceEntry[],
): readonly WorkspaceEntry[] {
  // Cheap per-render pass; memoizing on `executions` would defeat the point —
  // its identity changes every streaming frame while the SHAs rarely do. The
  // signature collapses those frames into a stable memo key.
  const refByName = collectLatestShas(executions);
  const signature = [...refByName]
    .map(([name, sha]) => `${name}\u0001${sha}`)
    .join("\u0000");

  return useMemo(() => {
    if (refByName.size === 0) return entries;

    const gitEntries = entries.filter((entry) => entry.type === "git");
    let decorated = false;

    const next = entries.map((entry) => {
      const readRef = resolveReadRef(entry, gitEntries.length, refByName);
      if (!readRef || readRef === entry.readRef) return entry;
      decorated = true;
      return { ...entry, readRef };
    });

    return decorated ? next : entries;
    // `signature` is the value-equality key for `refByName` (rebuilt each
    // render); the map itself must stay out of the deps.
  }, [entries, signature]);
}

/** Latest non-empty write-back commit SHA per workspace entry name. */
function collectLatestShas(
  executions: readonly AgentExecution[],
): Map<string, string> {
  const refByName = new Map<string, string>();
  for (const execution of executions) {
    for (const wb of execution.status?.workspaceWriteBacks ?? []) {
      if (wb.commitSha) refByName.set(wb.workspaceEntryName, wb.commitSha);
    }
  }
  return refByName;
}

/**
 * The write-back SHA for one entry, honoring the runner's single-entry
 * convention: with exactly one git entry, any write-back applies to it
 * (single-entry sessions write back under an empty entry name).
 */
function resolveReadRef(
  entry: WorkspaceEntry,
  gitEntryCount: number,
  refByName: ReadonlyMap<string, string>,
): string | undefined {
  if (entry.type !== "git") return undefined;

  const byName = refByName.get(entry.name);
  if (byName) return byName;

  if (gitEntryCount === 1) {
    // Single-entry sessions write back under an empty entry name; a lone
    // unambiguous name is equally safe to claim. Anything else (multiple
    // names against one entry) is malformed status data — decorate nothing
    // rather than guess.
    const unnamed = refByName.get("");
    if (unnamed) return unnamed;
    if (refByName.size === 1) return refByName.values().next().value;
  }

  return undefined;
}
