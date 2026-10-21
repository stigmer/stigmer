// Classification helpers for text content: whether a File reads as text, and
// how a text body renders, whether it came from a File, a repository file or
// a plan. Domain: run.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";

/**
 * File extensions recognized as human-readable text content.
 *
 * Used by {@link isTextFile} to determine whether a File's
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
 * Determines whether a File likely holds human-readable text: a `text/*`
 * media type, or a filename extension in the {@link TEXT_EXTENSIONS} set.
 *
 * Use this to decide whether to read a File's text with `useFileContent`.
 * Binary or unknown Files are downloaded instead.
 *
 * @example
 * ```ts
 * const shouldFetch = isTextFile(file);
 * ```
 */
export function isTextFile(file: StigmerFile): boolean {
  if ((file.spec?.mimeType ?? "").startsWith("text/")) return true;
  const ext = getFileExtension(file.spec?.filename ?? "");
  return ext !== null && TEXT_EXTENSIONS.has(ext);
}

// ---------------------------------------------------------------------------
// Render mode classification
// ---------------------------------------------------------------------------

/**
 * Content rendering strategy for a text file preview.
 *
 * Used by {@link TextContentRenderer} to dispatch to the correct
 * renderer, and by platform builders who want to implement custom
 * rendering logic based on file type.
 *
 * - `"markdown"` — rendered HTML via `react-markdown` with themed components
 * - `"yaml"` — CSS-only YAML syntax highlighting
 * - `"json"` — pretty-printed JSON with key/value coloring
 * - `"text"` — monospace plain text with line numbers
 */
export type TextRenderMode = "markdown" | "yaml" | "json" | "text";

const YAML_EXTENSIONS = new Set(["yaml", "yml"]);
const JSON_EXTENSIONS = new Set(["json"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);

/**
 * Extracts the lowercase file extension from a file name string.
 *
 * Returns `null` when the name has no extension or is empty.
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
 * Determines the optimal rendering strategy for a text file.
 *
 * Inspects the file extension first, then falls back to the optional
 * `contentType` MIME string returned by the server. Platform builders
 * can use this to implement custom rendering or to display a mode
 * indicator in their UI.
 *
 * @param fileName - File name (e.g., `"README.md"`, `"config.yaml"`)
 * @param contentType - Optional MIME content type from the server response
 *
 * @example
 * ```ts
 * getTextRenderMode("README.md");                   // "markdown"
 * getTextRenderMode("config.yaml");                 // "yaml"
 * getTextRenderMode("data.json");                   // "json"
 * getTextRenderMode("script.py");                   // "text"
 * getTextRenderMode("unknown", "application/json"); // "json"
 * ```
 */
export function getTextRenderMode(
  fileName: string,
  contentType?: string | null,
): TextRenderMode {
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
