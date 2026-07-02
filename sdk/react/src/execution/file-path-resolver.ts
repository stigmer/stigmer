import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";

const PLATFORM_PREFIX = ".stigmer/";
const PLATFORM_DIR_NAME = ".stigmer";

/**
 * Result of classifying a tool-call file path against the virtual
 * platform mount (`.stigmer/`) namespace.
 */
export type PathClassification =
  | {
      /** The path targets a workspace source entry. */
      readonly kind: "workspace";
      /** Path relative to the workspace root, with `.stigmer/` prefix stripped. */
      readonly remainder: string;
    }
  | {
      /** The path targets the virtual platform mount (`.stigmer/`). */
      readonly kind: "platform";
      /** Path within the platform namespace, after the `.stigmer/` prefix. */
      readonly subpath: string;
    };

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

/** A file path split into its directory prefix and final segment for display. */
export interface DisplayPath {
  /**
   * The directory portion including the trailing slash (e.g. `"src/app/"`), or
   * `""` when the path has no directory. Rendered dimmed and allowed to
   * truncate — it is context, not identity.
   */
  readonly dir: string;
  /**
   * The final path segment — the file name (e.g. `"main.ts"`). This is the
   * identity of the change and must never be clipped.
   */
  readonly base: string;
}

/**
 * Splits a file path into `{ dir, base }` for filename-first display.
 *
 * The motivation: a raw tool-call path is frequently an absolute, deeply-nested
 * string (`/Users/me/scm/.../notes.md`), and naive CSS `truncate` on the whole
 * path clips the *end* — hiding the file name, the one part that identifies the
 * change. Splitting lets the renderer keep the base name always visible and
 * truncate only the (dimmed) directory.
 *
 * Pure (no React) so it is unit-testable in isolation and reusable by any
 * surface. A trailing slash is tolerated (a directory path keeps its last
 * segment as the base); a path with no slash is all base.
 */
export function splitDisplayPath(path: string): DisplayPath {
  if (!path) return { dir: "", base: "" };
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return { dir: "", base: trimmed };
  const base = trimmed.slice(idx + 1);
  // A path that was only slashes collapses to the original — never an empty base.
  return base ? { dir: trimmed.slice(0, idx + 1), base } : { dir: "", base: trimmed };
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
  let cleanRelPath = relPath.replace(/^\/+/, "");

  // Guard against relPath that accidentally duplicates the org/repo
  // already encoded in gitUrl (e.g. relPath = "acme/app/src/main.go"
  // when repoPath is "acme/app"). Strip the redundant prefix so the
  // final URL doesn't contain the repo path twice.
  if (cleanRelPath.startsWith(repoPath + "/")) {
    cleanRelPath = cleanRelPath.slice(repoPath.length + 1);
  }

  return `https://github.com/${repoPath}/blob/${ref}/${cleanRelPath}`;
}

/**
 * Resolved action for a file path. Consumed by {@link FilePathLink}
 * to decide rendering (anchor vs. copy button).
 */
export type ResolvedPathAction =
  | {
      /** Open the path as a navigable URL (e.g. GitHub blob link). */
      readonly action: "link";
      /** Resolved external URL to open. */
      readonly url: string;
      /** Human-readable label for the link action. */
      readonly tooltip: string;
    }
  | {
      /** Copy the path to the clipboard (no navigable URL available). */
      readonly action: "copy";
      /** Resolved path string to copy. */
      readonly value: string;
      /** Human-readable label for the copy action. */
      readonly tooltip: string;
    };

/**
 * Resolves a tool-call file path to a user action.
 *
 * Resolution strategy (mirrors the CLI's `buildHyperlinkedPath`):
 *
 * 1. **Platform paths** (`.stigmer/` prefix) → copy raw path.
 * 2. **Workspace paths** → match against workspace entries:
 *    - Single entry: treat path as relative to that entry.
 *    - Multiple entries: scan path segments for an entry name match
 *      (handles org-prefixed paths like `plantonhq/agent-fleet/...`).
 *      Unmatched paths fall back to the first entry.
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
 * segment is tested against entry names. When the first segment
 * doesn't match, deeper segments are scanned — this handles tool-call
 * paths that embed an org prefix (e.g. `plantonhq/agent-fleet/...`
 * where the entry name is `agent-fleet`). Unmatched paths fall back
 * to the first entry.
 */
function matchWorkspaceEntry(
  relPath: string,
  entries: readonly WorkspaceEntry[],
): { entry: WorkspaceEntry; relPath: string } {
  if (entries.length === 1) {
    return { entry: entries[0], relPath };
  }

  const segments = relPath.split("/");

  for (let i = 0; i < segments.length; i++) {
    for (const entry of entries) {
      if (entry.name === segments[i]) {
        const rest = segments.slice(i + 1).join("/");
        return { entry, relPath: rest };
      }
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
