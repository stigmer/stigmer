import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * File extensions recognized as human-readable text content.
 *
 * Used by {@link isTextArtifact} to determine whether an artifact's
 * content can be fetched and displayed as text (YAML preview, resource
 * detection, syntax-highlighted preview).
 *
 * Covers configuration formats, documentation, and common source code
 * extensions that Stigmer agents typically produce.
 */
const TEXT_EXTENSIONS = new Set([
  "yaml",
  "yml",
  "json",
  "md",
  "txt",
  "toml",
  "xml",
  "csv",
  "log",
  "sh",
  "bash",
  "py",
  "ts",
  "js",
  "go",
  "rs",
  "html",
  "css",
  "sql",
  "env",
  "cfg",
  "ini",
  "conf",
]);

/**
 * Extracts the lowercase file extension from an artifact's name.
 *
 * Returns `null` when the name has no extension or is empty.
 *
 * @example
 * ```ts
 * getArtifactExtension(artifact); // "yaml"
 * getArtifactExtension(noExtArtifact); // null
 * ```
 */
export function getArtifactExtension(
  artifact: ExecutionArtifact,
): string | null {
  const name = artifact.name;
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1 || lastDot === name.length - 1) return null;
  return name.slice(lastDot + 1).toLowerCase();
}

/**
 * Determines whether an artifact likely contains human-readable text.
 *
 * Returns `false` for directory artifacts (which are stored as ZIP files)
 * regardless of name. For file artifacts, checks whether the file
 * extension is in the {@link TEXT_EXTENSIONS} set.
 *
 * Use this to decide whether to call {@link useArtifactContent} for
 * a given artifact. Binary or unknown-extension artifacts should use
 * the download URL instead.
 *
 * @example
 * ```ts
 * const shouldFetch = isTextArtifact(artifact) && Number(artifact.sizeBytes) < MAX_SIZE;
 * ```
 */
export function isTextArtifact(artifact: ExecutionArtifact): boolean {
  if (artifact.kind === ExecutionArtifactKind.DIRECTORY) return false;

  const ext = getArtifactExtension(artifact);
  if (ext === null) return false;

  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Checks whether an artifact's pre-signed download URL has expired.
 *
 * Returns `true` when:
 * - `expiresAt` is empty or cannot be parsed as a valid date
 * - The current time is past the expiration timestamp
 *
 * Expired URLs can be refreshed via `stigmer.agentExecution.getArtifactDownloadUrl()`.
 */
export function isArtifactExpired(artifact: ExecutionArtifact): boolean {
  if (!artifact.expiresAt) return true;

  const expiresMs = Date.parse(artifact.expiresAt);
  if (Number.isNaN(expiresMs)) return true;

  return Date.now() >= expiresMs;
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Formats a byte count as a human-readable file size string.
 *
 * Accepts both `bigint` (from protobuf `int64` fields like
 * `ExecutionArtifact.sizeBytes`) and `number`.
 *
 * Uses base-1024 (binary) units with one decimal place.
 *
 * @example
 * ```ts
 * formatArtifactSize(0n);       // "0 B"
 * formatArtifactSize(1024);     // "1.0 KB"
 * formatArtifactSize(1536n);    // "1.5 KB"
 * formatArtifactSize(2621440n); // "2.5 MB"
 * ```
 */
export function formatArtifactSize(sizeBytes: bigint | number): string {
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
