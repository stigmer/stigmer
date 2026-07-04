// Pure ranking function behind workspace search. Kept separate from the hook and
// component so the matching/ranking rules are exhaustively unit-testable in
// isolation (no React, no async).
//
// Match semantics intentionally mirror `internal/file-tree/filterFileTree` —
// case-insensitive substring — but widened from a node's basename to the full
// relative path, so `foo/bar` is findable and directory context is searchable
// (DD-10). The trivial predicate is not extracted into a shared micro-module; a
// cross-reference comment is the lower-coupling, honest choice.

import type { WorkspaceFileEntry } from "./WorkspaceFileLister.js";

/**
 * A workspace file that matched a search query.
 *
 * `matchStart`/`matchEnd` are code-unit offsets into `path` (a half-open
 * `[start, end)` range) for the single contiguous substring hit, so a consumer
 * can highlight exactly the matched span with `path.slice(...)`.
 */
export interface WorkspaceFileMatch {
  /** Repo-relative (git) or root-relative (local) path of the matched file. */
  readonly path: string;
  /** Inclusive start offset of the matched substring within `path`. */
  readonly matchStart: number;
  /** Exclusive end offset of the matched substring within `path`. */
  readonly matchEnd: number;
}

/** A match plus the ranking signal used only for sorting. */
interface RankedMatch extends WorkspaceFileMatch {
  /** `true` when the hit falls within the basename (after the last `/`). */
  readonly isBasenameHit: boolean;
}

/**
 * Ranks a flat listing against a query, returning matched files best-first.
 *
 * - Case-insensitive substring on the full relative path.
 * - Directories and advisory `notice` entries are never matched (a defensive
 *   guard even though the shared cache already strips notices — DD-11).
 * - Empty/whitespace query returns `[]` (search shows a hint, not everything).
 *
 * Ranking, in order: a basename hit outranks a path-only hit; then an earlier
 * match offset; then a shorter path; then lexicographic path for a stable,
 * deterministic order.
 */
export function matchWorkspaceFiles(
  files: readonly WorkspaceFileEntry[],
  query: string,
): WorkspaceFileMatch[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const needle = trimmed.toLowerCase();
  const ranked: RankedMatch[] = [];

  for (const file of files) {
    if (file.isDirectory || file.notice) continue;

    const matchStart = file.path.toLowerCase().indexOf(needle);
    if (matchStart === -1) continue;

    const lastSlash = file.path.lastIndexOf("/");
    ranked.push({
      path: file.path,
      matchStart,
      matchEnd: matchStart + needle.length,
      isBasenameHit: matchStart >= lastSlash + 1,
    });
  }

  ranked.sort(compareMatches);

  return ranked.map(({ path, matchStart, matchEnd }) => ({
    path,
    matchStart,
    matchEnd,
  }));
}

function compareMatches(a: RankedMatch, b: RankedMatch): number {
  if (a.isBasenameHit !== b.isBasenameHit) return a.isBasenameHit ? -1 : 1;
  if (a.matchStart !== b.matchStart) return a.matchStart - b.matchStart;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return a.path.localeCompare(b.path);
}
