// View-model for a conversation's File rows, with the adapter from a File.
// Domain: run.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";

/**
 * What a File row displays, mapped from a File and where the agent finds it.
 *
 * The view-model carries no identity; list keys and open/download behavior
 * stay with the hosts that render the row.
 */
export interface FileRowItem {
  /** Display label: the last segment of the File's place (its filename by default). */
  readonly name: string;
  /** House-tooltip content: the File's place, the fullest location known. */
  readonly tooltip: string;
  /**
   * Disambiguation subtitle rendered after the name when another row shares
   * the same name: the place's folder. `null` when not needed.
   */
  readonly subtitlePath: string | null;
  /** Content size in bytes (protobuf `int64` is `bigint`). */
  readonly sizeBytes: bigint | number;
}

/**
 * Adapts a File to a row item.
 *
 * @param hasNameCollision - When `true`, the place's folder becomes the
 *   disambiguation subtitle. Typically supplied from
 *   `SessionOutputEntry.hasNameCollision`.
 * @param place - Where the agent finds the File, relative to its folder:
 *   a given File's settled mount path. Defaults to the output path, then
 *   the filename.
 */
export function fromFile(file: StigmerFile, hasNameCollision = false, place?: string): FileRowItem {
  const filename = file.spec?.filename ?? "";
  const where = place || file.status?.outputPath || "";
  const name = where ? where.slice(where.lastIndexOf("/") + 1) : filename;
  return {
    name: name || filename,
    tooltip: where || filename,
    subtitlePath: hasNameCollision && where ? parentDirectory(where) : null,
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
