"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { isTerminalPhase } from "../execution/execution-phases.js";

/**
 * A single artifact entry enriched with the execution context needed
 * for content fetching and Apply/Push gating.
 *
 * The `executionId` identifies which execution produced (or last
 * updated) this artifact — required by {@link useArtifactContent} and
 * {@link ArtifactPreviewModal}. `isTerminal` controls whether the
 * Apply CTA is enabled in the preview modal.
 */
export interface SessionArtifactEntry {
  /** The proto artifact record containing name, path, size, and download URL. */
  readonly artifact: ExecutionArtifact;
  /** ID of the execution that produced this artifact version. */
  readonly executionId: string;
  /** Whether the producing execution is in a terminal phase. */
  readonly isTerminal: boolean;
  /**
   * `true` when another artifact in the deduplicated list shares the
   * same display `name` but has a different `sandbox_path`. Consumers
   * use this to render path context for disambiguation.
   */
  readonly hasNameCollision: boolean;
}

/** Return value of {@link useSessionArtifacts}. */
export interface UseSessionArtifactsReturn {
  /** Deduplicated, alphabetically-sorted artifacts from all executions. */
  readonly artifacts: readonly SessionArtifactEntry[];
  /** `true` when there is at least one artifact across all executions. */
  readonly hasArtifacts: boolean;
  /** Total number of deduplicated artifacts. */
  readonly artifactCount: number;
}

/**
 * The stable identity of an artifact within a session. Uses `sandbox_path`
 * when available (the artifact's filesystem identity within the session
 * sandbox), falling back to `name` for older artifacts that predate the field.
 *
 * This is the SINGLE source of truth for artifact identity across three sites
 * that must agree or a tab could fail to resolve its artifact:
 * 1. deduplication here (latest execution wins per key),
 * 2. the virtual-document tab `path` when an artifact opens in the editor area
 *    (see `SessionViewer` / `useSessionPanel.openArtifact`), and
 * 3. the `artifactKey → entry` lookup that renders the open tab's document.
 *
 * Its basename doubles as the editor tab's label (paths render as their last
 * `/` segment in `EditorTabs`), so `sandbox_path` gives a natural filename
 * label with cross-directory disambiguation for free.
 */
export function artifactKey(artifact: ExecutionArtifact): string {
  return artifact.sandboxPath || artifact.name;
}

/**
 * Pure derivation hook that aggregates artifacts across all executions
 * in a session into a unified, deduplicated, alphabetically-sorted
 * list — like a file explorer showing the conversation's output.
 *
 * Follows the same `useMemo`-based pattern as
 * {@link useExecutionArtifacts}: no side effects, no data fetching.
 *
 * **Dedup semantics:** Artifacts are keyed by `sandbox_path` (the
 * original filesystem path in the agent sandbox). When multiple
 * executions produce an artifact at the same path, the latest
 * execution's version wins — matching filesystem overwrite semantics.
 *
 * **Sorting:** Entries are sorted alphabetically by display `name`
 * (case-insensitive). This matches the file-explorer mental model
 * where users scan by filename, not by creation order.
 *
 * **Name collision detection:** When two artifacts share the same
 * display `name` but differ in `sandbox_path`, both entries are
 * flagged with `hasNameCollision: true` so consumers can render path
 * context for disambiguation.
 *
 * @param executions - All executions for a session, in chronological
 *   order (as returned by `listBySession`). Pass both completed and
 *   active-stream executions.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 * const allExecutions = [
 *   ...conv.completedExecutions,
 *   ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
 * ];
 * const { artifacts, hasArtifacts } = useSessionArtifacts(allExecutions);
 * ```
 *
 * @see useExecutionArtifacts — single-execution artifact derivation
 * @see ArtifactsWidget — styled component that renders this data
 */
export function useSessionArtifacts(
  executions: readonly AgentExecution[],
): UseSessionArtifactsReturn {
  return useMemo(() => {
    const entryMap = new Map<string, SessionArtifactEntry>();

    for (const execution of executions) {
      const executionId = execution.metadata?.id ?? "";
      const phase =
        execution.status?.phase ??
        ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      const terminal = isTerminalPhase(phase);

      for (const artifact of execution.status?.artifacts ?? []) {
        const key = artifactKey(artifact);
        entryMap.set(key, {
          artifact,
          executionId,
          isTerminal: terminal,
          hasNameCollision: false,
        });
      }
    }

    const entries = Array.from(entryMap.values());

    entries.sort((a, b) =>
      a.artifact.name.localeCompare(b.artifact.name, undefined, {
        sensitivity: "base",
      }),
    );

    // Detect name collisions: entries that share a display name but
    // have different sandbox paths need path context for disambiguation.
    const nameCount = new Map<string, number>();
    for (const entry of entries) {
      const lower = entry.artifact.name.toLowerCase();
      nameCount.set(lower, (nameCount.get(lower) ?? 0) + 1);
    }

    const result: SessionArtifactEntry[] = entries.map((entry) => {
      const lower = entry.artifact.name.toLowerCase();
      if ((nameCount.get(lower) ?? 0) > 1) {
        return { ...entry, hasNameCollision: true };
      }
      return entry;
    });

    return {
      artifacts: result,
      hasArtifacts: result.length > 0,
      artifactCount: result.length,
    };
  }, [executions]);
}
