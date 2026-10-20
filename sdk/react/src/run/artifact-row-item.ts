// View-model for artifact list rows, with the adapter from a File a turn
// returned. Domain: run.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";

/**
 * What an artifact row displays, mapped from an output File.
 *
 * The view-model carries no identity; list keys and open/download behavior
 * stay with the hosts that render the row.
 */
export interface ArtifactRowItem {
  /** Display label (the filename). */
  readonly name: string;
  /** House-tooltip content: the output path, the fullest location known. */
  readonly tooltip: string;
  /**
   * Disambiguation subtitle rendered after the name when another row shares
   * the same filename: the output path's folder. `null` when not needed.
   */
  readonly subtitlePath: string | null;
  /** Content size in bytes (protobuf `int64` is `bigint`). */
  readonly sizeBytes: bigint | number;
}

/**
 * Adapts an output File to a row item.
 *
 * @param hasNameCollision - When `true`, the output path's folder becomes the
 *   disambiguation subtitle. Typically supplied from
 *   `SessionArtifactEntry.hasNameCollision`.
 */
export function fromFile(file: StigmerFile, hasNameCollision = false): ArtifactRowItem {
  const name = file.spec?.filename ?? "";
  const outputPath = file.status?.outputPath ?? "";
  return {
    name,
    tooltip: outputPath || name,
    subtitlePath: hasNameCollision && outputPath ? parentDirectory(outputPath) : null,
    sizeBytes: file.status?.sizeBytes ?? BigInt(0),
  };
}

/**
 * Extracts a human-readable parent folder label from a path.
 * Given `reports/2026/q3.md` returns `2026/`.
 * Returns `null` when the path has no folder.
 */
export function parentDirectory(path: string): string | null {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  const parent = path.slice(0, lastSlash);
  const segment = parent.slice(parent.lastIndexOf("/") + 1);
  return segment ? `${segment}/` : null;
}
