/**
 * Display-time normalization for sandbox workspace paths.
 *
 * Mirrors the Python `humanize_sandbox_paths` in
 * `graphton.core.backends.platform_mount` — same semantics, same
 * replacement order.  The SDK version acts as a safety net for
 * historical data (persisted before backend humanization was added)
 * and streaming edge cases.
 *
 * @module
 */

/**
 * Replace absolute sandbox workspace paths with workspace-relative
 * display paths.
 *
 * Performs three ordered replacements:
 *
 * 1. `workspaceRoot + "/"` → empty string (makes paths workspace-relative)
 * 2. `workspaceRoot` (exact) → `"."` (the workspace root itself)
 * 3. Parent of `workspaceRoot` (sandbox home) → `"~"` (Unix convention)
 *
 * Returns `text` unchanged when `workspaceRoot` is empty.
 *
 * @example
 * ```ts
 * normalizeSandboxPaths(
 *   "ls /home/daytona/workspace/plantonhq/",
 *   "/home/daytona/workspace",
 * );
 * // => "ls plantonhq/"
 *
 * normalizeSandboxPaths(
 *   "cd /home/daytona/workspace && ls",
 *   "/home/daytona/workspace",
 * );
 * // => "cd . && ls"
 *
 * normalizeSandboxPaths(
 *   "cat /home/daytona/.bashrc",
 *   "/home/daytona/workspace",
 * );
 * // => "cat ~/.bashrc"
 * ```
 */
export function normalizeSandboxPaths(
  text: string,
  workspaceRoot: string,
): string {
  if (!text || !workspaceRoot) return text;

  const wsRoot = workspaceRoot.replace(/\/+$/, "");

  // 1) Strip workspace root prefix (with trailing slash) → workspace-relative
  text = replaceAll(text, wsRoot + "/", "");

  // 2) Replace bare workspace root → "."
  text = replaceAll(text, wsRoot, ".");

  // 3) Replace sandbox home prefix → "~"
  const lastSlash = wsRoot.lastIndexOf("/");
  if (lastSlash > 0) {
    const sandboxHome = wsRoot.slice(0, lastSlash);
    text = replaceAll(text, sandboxHome + "/", "~/");
    text = replaceAll(text, sandboxHome, "~");
  }

  return text;
}

function replaceAll(text: string, search: string, replacement: string): string {
  if (!search) return text;
  let result = text;
  let idx = result.indexOf(search);
  while (idx !== -1) {
    result = result.slice(0, idx) + replacement + result.slice(idx + search.length);
    idx = result.indexOf(search, idx + replacement.length);
  }
  return result;
}
