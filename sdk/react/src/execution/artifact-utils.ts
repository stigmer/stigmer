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
 * Delegates to {@link getFileExtension} for the actual parsing.
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
  return getFileExtension(artifact.name);
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

// ---------------------------------------------------------------------------
// Render mode classification
// ---------------------------------------------------------------------------

/**
 * Content rendering strategy for artifact file preview.
 *
 * Used by {@link ArtifactContentRenderer} to dispatch to the correct
 * renderer, and by platform builders who want to implement custom
 * rendering logic based on file type.
 *
 * - `"markdown"` — rendered HTML via `react-markdown` with themed components
 * - `"yaml"` — CSS-only YAML syntax highlighting
 * - `"json"` — pretty-printed JSON with key/value coloring
 * - `"text"` — monospace plain text with line numbers
 */
export type ArtifactRenderMode = "markdown" | "yaml" | "json" | "text";

const YAML_EXTENSIONS = new Set(["yaml", "yml"]);
const JSON_EXTENSIONS = new Set(["json"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);

/**
 * Extracts the lowercase file extension from a file name string.
 *
 * Returns `null` when the name has no extension or is empty.
 * Unlike {@link getArtifactExtension}, this operates on a plain
 * string — usable without a full `ExecutionArtifact` object.
 *
 * @example
 * ```ts
 * getFileExtension("agent.yaml");      // "yaml"
 * getFileExtension("README.md");       // "md"
 * getFileExtension("Makefile");        // null
 * ```
 */
export function getFileExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1 || lastDot === fileName.length - 1) return null;
  return fileName.slice(lastDot + 1).toLowerCase();
}

/**
 * Determines the optimal rendering strategy for a text artifact.
 *
 * Inspects the file extension first, then falls back to the optional
 * `contentType` MIME string returned by the server. Platform builders
 * can use this to implement custom rendering or to display a mode
 * indicator in their UI.
 *
 * @param fileName - Artifact file name (e.g., `"README.md"`, `"config.yaml"`)
 * @param contentType - Optional MIME content type from the server response
 *
 * @example
 * ```ts
 * getArtifactRenderMode("README.md");                   // "markdown"
 * getArtifactRenderMode("config.yaml");                 // "yaml"
 * getArtifactRenderMode("data.json");                   // "json"
 * getArtifactRenderMode("script.py");                   // "text"
 * getArtifactRenderMode("unknown", "application/json"); // "json"
 * ```
 */
export function getArtifactRenderMode(
  fileName: string,
  contentType?: string | null,
): ArtifactRenderMode {
  const ext = getFileExtension(fileName);

  if (ext && MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (ext && YAML_EXTENSIONS.has(ext)) return "yaml";
  if (ext && JSON_EXTENSIONS.has(ext)) return "json";

  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes("markdown")) return "markdown";
    if (ct.includes("yaml")) return "yaml";
    if (ct.includes("json")) return "json";
  }

  return "text";
}

// ---------------------------------------------------------------------------
// Size formatting
// ---------------------------------------------------------------------------

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
