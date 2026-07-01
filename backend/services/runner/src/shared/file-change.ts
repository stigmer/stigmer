/**
 * Pure path + binary-detection helpers shared by the native (deepagents) and
 * Cursor harnesses' file-review capture.
 *
 * Deliberately dependency-free and side-effect-free: no file IO, no diff
 * computation, no proto knowledge. `resolveWorkspacePath` normalizes a touched
 * path to (display path, absolute path); `looksBinary`/`bytesLookBinary` are the
 * single definition of "binary" across every capture substrate.
 *
 * @since First-Class Diff Review (#186)
 */

import { isAbsolute, join, relative } from "node:path";

/**
 * Heuristic binary detection: a NUL byte never appears in valid UTF-8 text. This
 * is a safety net, not a feature — the native edit/write tools are string-based,
 * so captured content is text in practice.
 */
export function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

/**
 * Byte-level binary detection: a NUL byte never appears in valid UTF-8 text. The
 * single definition of "binary" shared by every substrate that reads raw bytes
 * (the git substrate's blob reads and the CAS substrate's captured bodies), so
 * "what is binary" is decided one way across the whole file-review subsystem.
 *
 * Prefer this over {@link looksBinary} whenever the raw bytes are in hand: it is
 * exact, whereas scanning a UTF-8-decoded string can miss a NUL that a lossy
 * decode dropped.
 */
export function bytesLookBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0);
}

/**
 * Derive the workspace-root-relative display path and the absolute on-disk path
 * for a file a tool touched.
 *
 * `virtualRoot` distinguishes the two harness path conventions:
 *  - native (deepagents) addresses files against a virtual root where a leading
 *    "/" denotes the workspace root — mirrors `InlinePublisher.normalizePath`;
 *  - Cursor passes real filesystem paths that may be absolute.
 *
 * A path that is absolute but outside `rootDir` is displayed as-is (we never
 * surface an escaping `../../` relative path).
 */
export function resolveWorkspacePath(
  rawPath: string,
  rootDir: string,
  virtualRoot: boolean,
): { path: string; absolutePath: string } {
  if (virtualRoot || !isAbsolute(rawPath)) {
    const rel = rawPath.replace(/^\/+/, "").replace(/^\.\//, "");
    return { path: rel, absolutePath: join(rootDir, rel) };
  }
  const rel = relative(rootDir, rawPath);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return { path: rel, absolutePath: rawPath };
  }
  return { path: rawPath, absolutePath: rawPath };
}
