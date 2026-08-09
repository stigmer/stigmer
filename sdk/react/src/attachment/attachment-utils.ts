/**
 * Maximum attachment size in bytes (10 MB).
 *
 * Matches the CLI's `maxAttachmentSize` and the gRPC server's
 * `MaxRecvMsgSize`. Files exceeding this limit are rejected before
 * upload to avoid wasting bandwidth on requests that will fail.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Extension-to-MIME-type mapping for common file types.
 *
 * Used as a fallback when `File.type` is empty or generic. Mirrors
 * the CLI's `detectContentType` to ensure consistent behavior.
 */
const EXTENSION_MIME_MAP: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".json": "application/json",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".py": "text/x-python",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java",
  ".rb": "text/x-ruby",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".sql": "application/sql",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".conf": "text/plain",
  ".env": "text/plain",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/**
 * Detects the MIME content type for a file.
 *
 * Prefers the browser-provided `File.type` when available and
 * non-empty. Falls back to extension-based detection mirroring the
 * CLI's `detectContentType` function. Returns
 * `"application/octet-stream"` when neither source yields a result.
 */
export function detectContentType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }

  const dotIndex = file.name.lastIndexOf(".");
  if (dotIndex !== -1) {
    const ext = file.name.slice(dotIndex).toLowerCase();
    const mapped = EXTENSION_MIME_MAP[ext];
    if (mapped) return mapped;
  }

  return "application/octet-stream";
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * Formats a byte count as a human-readable string (e.g., `"2.3 MB"`).
 *
 * Uses base-1024 (binary) units with one decimal place, consistent
 * with {@link formatArtifactSize} in the artifact utilities.
 */
export function formatFileSize(bytes: number): string {
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

/**
 * Validates a file against the attachment size limit.
 *
 * Returns `null` when valid, or an error message string when the
 * file exceeds {@link MAX_ATTACHMENT_BYTES}.
 */
export function validateAttachmentSize(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} exceeds the 10 MB attachment limit (${formatFileSize(file.size)})`;
  }
  return null;
}

/**
 * Returns `name` unchanged when it is not in `taken`, otherwise the first
 * free `stem-2.ext`, `stem-3.ext`, … variant.
 *
 * Duplicate filenames within one turn are not a cosmetic problem:
 * attachments materialize at `.stigmer/inputs/{filename}`, where the
 * deep-agent harness fails the whole execution on a mount-path collision
 * and the Cursor harness silently overwrites the earlier file. A visible
 * rename on the attachment chip is strictly better than either outcome.
 */
export function uniquifyFilename(
  name: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(name)) return name;

  const dotIndex = name.lastIndexOf(".");
  // A leading dot (".env") is a hidden-file prefix, not an extension.
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const ext = dotIndex > 0 ? name.slice(dotIndex) : "";

  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}
