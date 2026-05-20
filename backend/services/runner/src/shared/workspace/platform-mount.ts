/**
 * Virtual platform mount — path classification and display humanization
 * for the `.stigmer/` namespace.
 *
 * The platform owns the `.stigmer/` namespace inside the agent's virtual
 * view of the workspace. Platform files (skills, inputs) physically live
 * in an external `platformDir` that is separate from the workspace
 * `rootDir`. Backend path-resolution methods call `classifyPlatformPath`
 * to decide whether a given path targets the platform mount or the
 * workspace, keeping the routing decision in a single place.
 *
 * All functions in this module are **pure** — no I/O, no side effects.
 * They operate exclusively on strings.
 *
 * See Python reference: graphton/core/backends/platform_mount.py (AD-01 v3).
 */

import { dirname } from "node:path";

/** Prefix that identifies paths targeting the virtual platform mount. */
export const PLATFORM_PREFIX = ".stigmer/";

/** Directory name used in listings and equality checks. */
export const PLATFORM_DIR_NAME = ".stigmer";

/**
 * Environment variable injected into `execute()` calls so shell commands
 * can access platform files via `$STIGMER_PLATFORM_DIR/skills/…`.
 */
export const STIGMER_PLATFORM_DIR_ENV = "STIGMER_PLATFORM_DIR";

/**
 * Matches `$STIGMER_PLATFORM_DIR` and `${STIGMER_PLATFORM_DIR}` in
 * display strings. Brace form is tried first so the replacement does not
 * leave stray braces. The negative lookahead on the bare-dollar form
 * prevents matching `$STIGMER_PLATFORM_DIR_OTHER` as a false positive.
 */
const PLATFORM_ENV_RE = new RegExp(
  `\\$\\{${STIGMER_PLATFORM_DIR_ENV}\\}`
  + `|\\$${STIGMER_PLATFORM_DIR_ENV}(?![A-Za-z0-9_])`,
  "g",
);

/**
 * Matches `.stigmer` in shell commands when it appears as a standalone
 * path component (e.g. `.stigmer/skills/…`), not as part of a longer
 * name (`my.stigmer`) or a subdirectory (`foo/.stigmer`).
 */
const STIGMER_DIR_CMD_RE = /(?<!\w)(?<!\/)\.stigmer(?![a-zA-Z0-9_])/g;

/**
 * Classify whether `relPath` targets the virtual platform mount.
 *
 * Strips leading slashes before checking so that absolute-looking paths
 * (`/.stigmer/skills/…`) are handled identically to relative ones.
 *
 * @returns An object with `isPlatform` (true when path falls under
 *   `.stigmer/`) and `remainder` (the path relative to whichever root
 *   applies — `platformDir` when platform, `rootDir` when workspace).
 */
export function classifyPlatformPath(relPath: string): {
  isPlatform: boolean;
  remainder: string;
} {
  const clean = relPath.replace(/^\/+/, "");

  if (clean.startsWith(PLATFORM_PREFIX)) {
    return { isPlatform: true, remainder: clean.slice(PLATFORM_PREFIX.length) };
  }

  if (clean === PLATFORM_DIR_NAME || clean === PLATFORM_DIR_NAME + "/") {
    return { isPlatform: true, remainder: "" };
  }

  return { isPlatform: false, remainder: clean };
}

/**
 * Replace platform environment-variable references with the user-facing
 * `.stigmer` virtual-mount prefix.
 *
 * Intended for **display strings only** (approval previews, messages) —
 * not for the actual command executed in the sandbox, where the shell
 * must expand the real environment variable.
 *
 * Handles both `$STIGMER_PLATFORM_DIR` and `${STIGMER_PLATFORM_DIR}`.
 */
export function humanizePlatformRefs(text: string): string {
  if (!text) return text;
  return text.replace(PLATFORM_ENV_RE, PLATFORM_DIR_NAME);
}

/**
 * Replace `.stigmer` virtual-mount references in a shell command with
 * the `$STIGMER_PLATFORM_DIR` environment variable.
 *
 * The execute environment already has `STIGMER_PLATFORM_DIR` set, so
 * the shell expands the variable at runtime.
 *
 * This is the inverse of `humanizePlatformRefs`: that function rewrites
 * `$STIGMER_PLATFORM_DIR` → `.stigmer` for display, while this function
 * rewrites `.stigmer` → `$STIGMER_PLATFORM_DIR` for execution.
 *
 * Callers **must** guard this behind a `platformDir != null` check to
 * avoid replacing `.stigmer` when it is a real directory.
 */
export function resolvePlatformCommand(command: string): string {
  if (!command) return command;
  return command.replace(STIGMER_DIR_CMD_RE, `$${STIGMER_PLATFORM_DIR_ENV}`);
}

/**
 * Replace absolute sandbox workspace paths with workspace-relative
 * display paths.
 *
 * Intended for **display strings only** (approval previews, streamed
 * messages) — not for the actual command executed in the sandbox.
 *
 * Performs three ordered replacements:
 * 1. `workspaceRoot + "/"` → empty string (workspace-relative paths)
 * 2. `workspaceRoot` (exact) → `"."` (the workspace root itself)
 * 3. Sandbox home dir (parent of workspaceRoot) → `"~"` (paths outside
 *    the workspace, e.g. `/home/daytona/.bashrc` → `~/.bashrc`)
 *
 * Returns `text` unchanged when `workspaceRoot` is empty.
 */
export function humanizeSandboxPaths(
  text: string,
  workspaceRoot: string,
): string {
  if (!text || !workspaceRoot) return text;

  const wsRoot = workspaceRoot.replace(/\/+$/, "");

  // 1) workspace_root + "/" → "" (relative paths)
  text = text.replaceAll(wsRoot + "/", "");

  // 2) bare workspace_root → "." (must run after slash-suffixed above)
  text = text.replaceAll(wsRoot, ".");

  // 3) sandbox home → "~" (parent of workspace root)
  const sandboxHome = dirname(wsRoot);
  if (sandboxHome && sandboxHome !== "/") {
    text = text.replaceAll(sandboxHome + "/", "~/");
    text = text.replaceAll(sandboxHome, "~");
  }

  return text;
}

/**
 * Resolve agent environment-variable references to their values in a
 * display string.
 *
 * Replaces `$KEY` and `${KEY}` with the corresponding value from
 * `envVars` for every key that is **not** marked as secret.
 *
 * `$STIGMER_PLATFORM_DIR` is handled separately by
 * `humanizePlatformRefs` and is always skipped here.
 *
 * Call this **after** `humanizePlatformRefs` so platform paths are
 * humanized before general env-var resolution runs.
 */
export function resolveDisplayEnvVars(
  text: string,
  envVars: Record<string, string>,
  secretKeys?: ReadonlySet<string>,
): string {
  if (!text || !envVars || Object.keys(envVars).length === 0) return text;

  const secrets = secretKeys ?? new Set<string>();

  for (const [key, value] of Object.entries(envVars)) {
    if (key === STIGMER_PLATFORM_DIR_ENV) continue;
    if (secrets.has(key)) continue;

    const pattern = new RegExp(
      `\\$\\{${escapeRegExp(key)}\\}`
      + `|\\$${escapeRegExp(key)}(?![A-Za-z0-9_])`,
      "g",
    );
    text = text.replace(pattern, value);
  }

  return text;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
