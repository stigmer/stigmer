// How a File's size reads, in one place: the conversation's Files, the
// Library, a plan card and the chat box's chips all show sizes, and they
// show them the same way. Takes a `bigint` (a proto `int64` such as
// `FileStatus.sizeBytes`) or a `number` (a browser `File.size`).

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Formats a byte count as a human-readable size, in base-1024 units with
 * one decimal place.
 *
 * @example
 * ```ts
 * formatFileSize(0n);       // "0 B"
 * formatFileSize(1024);     // "1.0 KB"
 * formatFileSize(1536n);    // "1.5 KB"
 * formatFileSize(2621440n); // "2.5 MB"
 * ```
 */
export function formatFileSize(sizeBytes: bigint | number): string {
  const bytes = typeof sizeBytes === "bigint" ? Number(sizeBytes) : sizeBytes;

  if (bytes === 0) return "0 B";

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1,
  );

  const value = bytes / Math.pow(1024, unitIndex);

  return unitIndex === 0
    ? `${bytes} B`
    : `${value.toFixed(1)} ${SIZE_UNITS[unitIndex]}`;
}
