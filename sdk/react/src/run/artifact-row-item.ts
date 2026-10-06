// View-model for artifact list rows, with the adapter from the session's
// run-artifact model. Domain: run.

import type { RunArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/artifact_pb";
import { RunArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

/**
 * What an artifact row displays, mapped from the session's `RunArtifact`
 * (embedded in `AgentRun.status.artifacts`).
 *
 * The view-model carries no identity; list keys and open/download behavior
 * stay with the hosts that render the row.
 */
export interface ArtifactRowItem {
  /** Display label (file or directory name). */
  readonly name: string;
  /** House-tooltip content — the fullest location/name known for the artifact. */
  readonly tooltip: string;
  /**
   * Disambiguation subtitle rendered after the name when another row shares
   * the same display name: the artifact's parent directory. `null` when not
   * needed.
   */
  readonly subtitlePath: string | null;
  /** Content size in bytes (protobuf `int64` is `bigint`). */
  readonly sizeBytes: bigint | number;
  /** Directory artifacts render a folder icon, a `/` suffix, and ZIP download copy. */
  readonly isDirectory: boolean;
}

/**
 * Adapts a session `RunArtifact` to a row item.
 *
 * @param hasNameCollision - When `true`, the artifact's parent directory (from
 *   `sandbox_path`) becomes the disambiguation subtitle. Typically supplied
 *   from `SessionArtifactEntry.hasNameCollision`.
 */
export function fromRunArtifact(
  artifact: RunArtifact,
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
    isDirectory: artifact.kind === RunArtifactKind.DIRECTORY,
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
