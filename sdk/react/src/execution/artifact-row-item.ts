// Type-agnostic view-model for artifact list rows, with adapters from both
// artifact data models. Domain: execution (shared by session + workflow).

import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";

/**
 * What an artifact row displays, independent of which artifact data model
 * produced it.
 *
 * Two artifact models exist and are deliberately unified ONLY at this
 * presentational layer, never at the data layer: the session's
 * `ExecutionArtifact` (embedded in `AgentExecution.status.artifacts`) and the
 * workflow's first-class `Artifact` resource. Their identity, provenance, and
 * download mechanics differ — so the view-model carries no identity; list
 * keys and open/download behavior stay with the domain-specific hosts.
 */
export interface ArtifactRowItem {
  /** Display label (file or directory name). */
  readonly name: string;
  /** Hover title — the fullest location/name known for the artifact. */
  readonly tooltip: string;
  /**
   * Disambiguation subtitle rendered after the name when another row shares
   * the same display name: the parent directory for sandbox-backed artifacts,
   * the producing task for workflow artifacts. `null` when not needed.
   */
  readonly subtitlePath: string | null;
  /** Content size in bytes (protobuf `int64` is `bigint`). */
  readonly sizeBytes: bigint | number;
  /** Directory artifacts render a folder icon, a `/` suffix, and ZIP download copy. */
  readonly isDirectory: boolean;
}

/**
 * Adapts a session `ExecutionArtifact` to a row item.
 *
 * @param hasNameCollision - When `true`, the artifact's parent directory (from
 *   `sandbox_path`) becomes the disambiguation subtitle. Typically supplied
 *   from `SessionArtifactEntry.hasNameCollision`.
 */
export function fromExecutionArtifact(
  artifact: ExecutionArtifact,
  hasNameCollision = false,
): ArtifactRowItem {
  return {
    name: artifact.name,
    tooltip: artifact.sandboxPath || artifact.name,
    subtitlePath:
      hasNameCollision && artifact.sandboxPath
        ? parentDirectory(artifact.sandboxPath)
        : null,
    sizeBytes: artifact.sizeBytes,
    isDirectory: artifact.kind === ExecutionArtifactKind.DIRECTORY,
  };
}

/**
 * Adapts a workflow `Artifact` resource to a row item.
 *
 * A workflow artifact is always a single content-typed blob — the resource
 * model has no directory concept — so `isDirectory` is always `false`. Name
 * collisions disambiguate by the producing task (`source.task_name`), the
 * workflow analog of the session's parent-directory subtitle.
 *
 * @param hasNameCollision - When `true` and the artifact has a source task,
 *   that task name becomes the disambiguation subtitle.
 */
export function fromArtifact(
  artifact: Artifact,
  hasNameCollision = false,
): ArtifactRowItem {
  const name =
    artifact.spec?.displayName || artifact.metadata?.name || "Unnamed";
  const taskName = artifact.spec?.source?.taskName ?? "";
  return {
    name,
    tooltip: name,
    subtitlePath: hasNameCollision && taskName ? taskName : null,
    sizeBytes: artifact.status?.sizeBytes ?? BigInt(0),
    isDirectory: false,
  };
}

/**
 * Extracts a human-readable parent directory label from a sandbox path.
 * Given `/workspace/configs/agent.yaml` returns `configs/`.
 * Returns `null` when the path has no meaningful parent segment.
 */
export function parentDirectory(sandboxPath: string): string | null {
  const lastSlash = sandboxPath.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  const parent = sandboxPath.slice(0, lastSlash);
  const segment = parent.slice(parent.lastIndexOf("/") + 1);
  return segment ? `${segment}/` : null;
}
