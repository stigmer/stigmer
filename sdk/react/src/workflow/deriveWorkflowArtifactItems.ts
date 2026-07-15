// Pure derivation of workflow Artifact resources into artifact-row entries.
// Domain: workflow (the Artifact-resource analog of useSessionArtifacts).

import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import {
  fromArtifact,
  type ArtifactRowItem,
} from "../execution/artifact-row-item.js";

/** One workflow artifact paired with its presentational row view-model. */
export interface WorkflowArtifactEntry {
  /** The full Artifact resource — identity for open/download behavior. */
  readonly artifact: Artifact;
  /** The row view-model rendered by `ArtifactRowView`. */
  readonly item: ArtifactRowItem;
}

/**
 * Derives the Artifacts facet's row list from a workflow execution's
 * artifacts (as returned by `useWorkflowExecutionArtifacts`).
 *
 * **Sorting:** alphabetical by display name (case-insensitive) — the
 * file-explorer mental model where users scan by filename, matching
 * `useSessionArtifacts`.
 *
 * **No dedup:** unlike the session model (where re-runs overwrite a sandbox
 * path and the latest wins), workflow `Artifact` records are immutable and
 * append-only — each is a distinct output, keyed by `metadata.id`.
 *
 * **Name collision detection:** when two artifacts share a display name,
 * both rows carry the producing task (`source.task_name`) as a subtitle for
 * disambiguation — the workflow analog of the session's parent-directory
 * subtitle.
 *
 * Pure function (not a hook): callers memoize on their artifacts reference.
 */
export function deriveWorkflowArtifactItems(
  artifacts: readonly Artifact[],
): readonly WorkflowArtifactEntry[] {
  const nameCount = new Map<string, number>();
  for (const artifact of artifacts) {
    const lower = displayNameOf(artifact).toLowerCase();
    nameCount.set(lower, (nameCount.get(lower) ?? 0) + 1);
  }

  const entries = artifacts.map((artifact): WorkflowArtifactEntry => {
    const hasNameCollision =
      (nameCount.get(displayNameOf(artifact).toLowerCase()) ?? 0) > 1;
    return { artifact, item: fromArtifact(artifact, hasNameCollision) };
  });

  return [...entries].sort((a, b) =>
    a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" }),
  );
}

function displayNameOf(artifact: Artifact): string {
  return artifact.spec?.displayName || artifact.metadata?.name || "Unnamed";
}
