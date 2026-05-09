import type { DiffHunk, FileDiffEntry, MultiFileDiffResult } from "./types";
import { computeDiff } from "./computeDiff";

/**
 * Compute a multi-file diff between two snapshots of a file tree.
 *
 * Each snapshot is a `Map<path, textContent>`. The function categorises
 * every path as `added`, `removed`, or `modified`, computes per-file
 * unified diffs for modified files, and returns an aggregate result.
 *
 * Pure function — no side effects, safe to call outside React.
 *
 * @param oldFiles - File map for the "before" version.
 * @param newFiles - File map for the "after" version.
 */
export function computeMultiFileDiff(
  oldFiles: ReadonlyMap<string, string>,
  newFiles: ReadonlyMap<string, string>,
): MultiFileDiffResult {
  const diffCache = new Map<string, readonly DiffHunk[]>();
  const files: FileDiffEntry[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  const allPaths = new Set([...oldFiles.keys(), ...newFiles.keys()]);

  for (const path of allPaths) {
    const oldContent = oldFiles.get(path);
    const newContent = newFiles.get(path);

    if (oldContent === undefined && newContent !== undefined) {
      const lineCount = countLines(newContent);
      files.push({ path, changeType: "added", additions: lineCount, deletions: 0 });
      totalAdditions += lineCount;

      const hunks = computeDiff("", newContent);
      diffCache.set(path, hunks);
    } else if (oldContent !== undefined && newContent === undefined) {
      const lineCount = countLines(oldContent);
      files.push({ path, changeType: "removed", additions: 0, deletions: lineCount });
      totalDeletions += lineCount;

      const hunks = computeDiff(oldContent, "");
      diffCache.set(path, hunks);
    } else if (oldContent !== undefined && newContent !== undefined && oldContent !== newContent) {
      const hunks = computeDiff(oldContent, newContent);
      const additions = hunks.reduce(
        (sum, h) => sum + h.lines.filter((l) => l.type === "added").length,
        0,
      );
      const deletions = hunks.reduce(
        (sum, h) => sum + h.lines.filter((l) => l.type === "removed").length,
        0,
      );
      files.push({ path, changeType: "modified", additions, deletions });
      totalAdditions += additions;
      totalDeletions += deletions;
      diffCache.set(path, hunks);
    }
  }

  files.sort(fileSortComparator);

  return {
    files,
    totalAdditions,
    totalDeletions,
    getDiff: (path: string) => diffCache.get(path) ?? [],
  };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}

/**
 * Sort changed files: SKILL.md first (primary file), then alphabetically.
 * Modified files before added, added before removed — mirrors GitHub's
 * convention of showing the most actionable changes first.
 */
function fileSortComparator(a: FileDiffEntry, b: FileDiffEntry): number {
  const aIsSkillMd = a.path === "SKILL.md" || a.path === "skill.md";
  const bIsSkillMd = b.path === "SKILL.md" || b.path === "skill.md";
  if (aIsSkillMd && !bIsSkillMd) return -1;
  if (!aIsSkillMd && bIsSkillMd) return 1;

  const order: Record<string, number> = { modified: 0, added: 1, removed: 2 };
  const typeSort = (order[a.changeType] ?? 3) - (order[b.changeType] ?? 3);
  if (typeSort !== 0) return typeSort;

  return a.path.localeCompare(b.path);
}
