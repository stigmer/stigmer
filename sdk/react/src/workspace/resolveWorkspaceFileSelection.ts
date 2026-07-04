// Resolve a transcript tool-call file path to an openable workspace-file
// selection. This is the seam that lets a click on a path in the message thread
// route to the same read-only Viewer a file-tree click drives (Slice 3).
//
// The hard part is NOT identity ("which entry") but PATH FORM. The reader and
// lister contracts are strict: `WorkspaceFileReader` / the GitHub Trees lister
// speak repo-root-relative (git) or root-relative (local) paths — the exact
// strings a file-tree node carries. Transcript tool-call paths are not
// guaranteed to be in that form: depending on harness and workspace layout they
// arrive workspace-relative, subdir-prefixed, or absolute (see
// `execution/file-review-status.ts` `changeForRowPath`, which documents the
// same variance and treats path matching as presentation-only).
//
// Rather than fuzzy-match, this resolver normalizes deterministically using only
// anchors the client already holds, grounded in how the runner provisions the
// workspace (`backend/.../workspace/provisioner.ts`):
//   - Single entry  -> cloned at the workspace root, so a (humanized) tool-call
//                      path is already repo/root-relative. Identity transform.
//   - Multiple git  -> each cloned into `<root>/<entry.name>/`, so the path is
//                      prefixed by the subdir name; strip it.
//   - Local (desktop) -> the native reader joins `entry.localPath` + a
//                      root-relative path; local tool paths may be absolute, so
//                      strip the known `entry.localPath` prefix.
//   - Cloud absolute -> strip the known `sandboxWorkspaceRoot` first.
// Anything that does not resolve to a definite relative path returns `null` so
// the caller keeps its existing copy/GitHub-link behavior — a wrong file can
// never open. Extending this to arbitrary/absolute paths belongs to a later
// slice that resolves against the authoritative file-tree index.

import { classifyPath } from "../execution/file-path-resolver.js";
import type { SelectedWorkspaceFile } from "../internal/store/workspace-file-selection-store.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";

/** Forward-slash-normalize and drop any leading slashes for prefix comparison. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Returns the portion of `path` beneath `anchor`, or `null` when `path` does
 * not sit under `anchor`. An exact match (the anchor itself, a directory) yields
 * `""` — the caller rejects it, since a directory is not a viewable file.
 */
function relativeTo(path: string, anchor: string): string | null {
  if (!anchor) return null;
  if (path === anchor) return "";
  if (path.startsWith(anchor + "/")) return path.slice(anchor.length + 1);
  return null;
}

/**
 * Resolves a transcript tool-call file path to the {@link SelectedWorkspaceFile}
 * that opens it in the read-only Viewer, or `null` when it cannot be resolved to
 * a definite repo/root-relative file (caller keeps copy/GitHub-link fallback).
 *
 * `entries` are the client-side workspace entries (`useWorkspaceEntries`), the
 * same list the Viewer resolves against, so the returned `entryId` is directly
 * usable. `sandboxWorkspaceRoot` (when the session has git-repo entries, e.g.
 * `/home/daytona/workspace`) is stripped first so cloud-absolute paths reduce to
 * workspace-relative before per-entry anchoring.
 *
 * The result `path` is guaranteed to match what the file tree / lister emits for
 * the same file, so opening from the transcript and from the tree produce an
 * identical selection (and hit the same content fetch/cache).
 */
export function resolveWorkspaceFileSelection(
  path: string,
  entries: readonly WorkspaceEntry[],
  sandboxWorkspaceRoot?: string,
): SelectedWorkspaceFile | null {
  if (!path || entries.length === 0) return null;

  // 1. Reduce a cloud-absolute path to workspace-relative using the known root.
  let work = normalize(path);
  if (sandboxWorkspaceRoot) {
    const root = normalize(sandboxWorkspaceRoot);
    const relToRoot = relativeTo(work, root);
    if (relToRoot !== null) work = relToRoot;
  }
  // The bare workspace root ("" after stripping, or the humanized ".") is not a
  // file.
  if (!work || work === ".") return null;

  // 2. The platform mount (`.stigmer/…`) is a virtual namespace, not a workspace
  //    file — checked after the root strip so an absolute `<root>/.stigmer/…`
  //    is caught too. Keep copy behavior for it.
  if (classifyPath(work).kind === "platform") return null;

  // 3. Anchor on the exact per-entry roots the client holds. Local entries
  //    anchor on their absolute `localPath`; multi-entry git repos anchor on the
  //    provisioning subdir (`entry.name`). A single git entry is cloned at the
  //    root, so it falls through to step 4.
  const isMulti = entries.length > 1;
  for (const entry of entries) {
    let anchor: string | null = null;
    if (entry.type === "local" && entry.localPath) {
      anchor = normalize(entry.localPath);
    } else if (entry.type === "git" && isMulti) {
      anchor = normalize(entry.name);
    }
    if (anchor === null) continue;

    const rel = relativeTo(work, anchor);
    // Exact match is the entry's own root directory, not a viewable file — stop
    // rather than fall through to the single-entry fallback (which would return
    // the raw root path).
    if (rel === "") return null;
    if (rel) return { entryId: entry.id, path: rel };
  }

  // 4. A single entry whose anchor did not apply (e.g. a git repo at the root, or
  //    a local path already root-relative): the path is already repo/root-relative.
  if (entries.length === 1) {
    return { entryId: entries[0].id, path: work };
  }

  // 5. Multi-entry with no anchor match: refuse to guess which entry owns it.
  return null;
}
