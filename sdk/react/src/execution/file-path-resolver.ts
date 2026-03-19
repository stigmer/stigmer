import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";

const PLATFORM_PREFIX = ".stigmer/";
const PLATFORM_DIR_NAME = ".stigmer";

/**
 * Result of classifying a tool-call file path against the virtual
 * platform mount (`.stigmer/`) namespace.
 */
export type PathClassification =
  | { readonly kind: "workspace"; readonly remainder: string }
  | { readonly kind: "platform"; readonly subpath: string };

/**
 * Classifies whether a path targets the virtual platform mount
 * (`.stigmer/skills/`, `.stigmer/inputs/`, etc.) or the workspace.
 *
 * Mirrors the Python `classify_platform_path` in
 * `graphton.core.backends.platform_mount` — same semantics, same
 * edge-case handling (leading-slash stripping, bare `.stigmer`).
 */
export function classifyPath(path: string): PathClassification {
  const clean = path.replace(/^\/+/, "");

  if (clean.startsWith(PLATFORM_PREFIX)) {
    return { kind: "platform", subpath: clean.slice(PLATFORM_PREFIX.length) };
  }
  if (clean === PLATFORM_DIR_NAME) {
    return { kind: "platform", subpath: "" };
  }
  return { kind: "workspace", remainder: clean };
}

/**
 * Constructs a browsable GitHub blob URL from a git clone URL.
 *
 * Returns `null` for non-GitHub hosts (graceful degradation — the
 * caller falls back to copy-to-clipboard).
 *
 * @param gitUrl   HTTPS clone URL (e.g. `https://github.com/acme/app.git`)
 * @param branch   Branch name (may be empty for default branch)
 * @param commit   Commit SHA (takes precedence over branch when set)
 * @param relPath  Workspace-relative file path
 */
export function resolveGitBrowseUrl(
  gitUrl: string,
  branch: string,
  commit: string,
  relPath: string,
): string | null {
  let url: URL;
  try {
    url = new URL(gitUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "github.com") return null;

  // Strip trailing `.git` and leading/trailing slashes from pathname
  const repoPath = url.pathname.replace(/\.git$/, "").replace(/^\/|\/$/g, "");
  if (!repoPath) return null;

  const ref = commit || branch || "HEAD";
  const cleanRelPath = relPath.replace(/^\/+/, "");

  return `https://github.com/${repoPath}/blob/${ref}/${cleanRelPath}`;
}

/**
 * Resolved action for a file path. Consumed by {@link FilePathLink}
 * to decide rendering (anchor vs. copy button).
 */
export type ResolvedPathAction =
  | { readonly action: "link"; readonly url: string; readonly tooltip: string }
  | { readonly action: "copy"; readonly value: string; readonly tooltip: string };

/**
 * Resolves a tool-call file path to a user action.
 *
 * Resolution strategy (mirrors the CLI's `buildHyperlinkedPath`):
 *
 * 1. **Platform paths** (`.stigmer/` prefix) → copy raw path.
 * 2. **Workspace paths** → match against workspace entries:
 *    - Single entry: treat path as relative to that entry.
 *    - Multiple entries: match first path segment against entry names.
 *      Unmatched segments fall back to the first entry (optimistic —
 *      single-workspace sessions are the common case).
 * 3. **Git source** → construct GitHub blob URL.
 * 4. **Local source** → join with absolute local path for copy.
 * 5. **Fallback** → copy the raw path.
 */
export function resolvePathAction(
  path: string,
  workspaceEntries: readonly WorkspaceEntry[],
): ResolvedPathAction {
  if (!path) {
    return { action: "copy", value: path, tooltip: "Copy path" };
  }

  const classification = classifyPath(path);

  if (classification.kind === "platform") {
    return { action: "copy", value: path, tooltip: "Copy path" };
  }

  const { remainder } = classification;
  if (workspaceEntries.length === 0) {
    return { action: "copy", value: path, tooltip: "Copy path" };
  }

  const { entry, relPath } = matchWorkspaceEntry(remainder, workspaceEntries);
  const source = entry.source?.source;

  if (source?.case === "gitRepo") {
    const url = resolveGitBrowseUrl(
      source.value.url,
      source.value.branch,
      source.value.commit,
      relPath,
    );
    if (url) {
      return { action: "link", url, tooltip: "Open on GitHub" };
    }
  }

  if (source?.case === "localPath") {
    const abs = joinLocalPath(source.value.path, relPath);
    return { action: "copy", value: abs, tooltip: "Copy path" };
  }

  return { action: "copy", value: path, tooltip: "Copy path" };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Matches a workspace-relative path against entries. With a single
 * entry the path is used as-is. With multiple entries the first path
 * segment is tested against entry names; unmatched paths fall back to
 * the first entry (same strategy as the CLI).
 */
function matchWorkspaceEntry(
  relPath: string,
  entries: readonly WorkspaceEntry[],
): { entry: WorkspaceEntry; relPath: string } {
  if (entries.length === 1) {
    return { entry: entries[0], relPath };
  }

  const slashIdx = relPath.indexOf("/");
  const firstSegment = slashIdx >= 0 ? relPath.slice(0, slashIdx) : relPath;

  for (const entry of entries) {
    if (entry.name === firstSegment) {
      const rest = slashIdx >= 0 ? relPath.slice(slashIdx + 1) : "";
      return { entry, relPath: rest };
    }
  }

  return { entry: entries[0], relPath };
}

function joinLocalPath(base: string, rel: string): string {
  if (!rel) return base;
  const cleanBase = base.replace(/\/+$/, "");
  const cleanRel = rel.replace(/^\/+/, "");
  return `${cleanBase}/${cleanRel}`;
}
