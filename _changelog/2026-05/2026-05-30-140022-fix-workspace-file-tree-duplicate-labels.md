# Fix Workspace File Tree Duplicate Folder Labels

**Date**: May 30, 2026

## Summary

Fixed a bug in the workspace file browser where directories appeared twice -- once as a plain text leaf and once as an expandable folder with a chevron. The root cause was `buildFileTree` receiving unfiltered lister output that included both explicit directory entries and nested file paths, producing duplicate sibling nodes.

## Problem Statement

When browsing workspace files in the Session Inspector, every directory that contained files rendered two entries: a non-interactive leaf row and a separate expandable folder row. This affected both the web console (GitHub Trees API lister) and the desktop app (Tauri native directory walker).

### Pain Points

- Duplicate rows for every directory created visual clutter and confusion
- The leaf row (no chevron) was not clickable/expandable, misleading users into thinking it was a file
- The issue worsened in repos with deep or many directories, doubling visible noise

## Solution

Filter `isDirectory: true` entries from the lister output before passing to `buildFileTree` in `useWorkspaceFiles`, the single choke point where all platform listers funnel into the tree builder. This matches the existing pattern already used by `SkillFileBrowser`.

## Implementation Details

**Root cause**: `buildFileTree` accepts a flat list of `{ path: string }` entries and synthesizes folder nodes from path segments. When listers also return explicit directory entries (e.g., `{ path: "src", isDirectory: true }`), `buildFileTree` inserts them as leaf nodes (single path segment, no children). Later, when it encounters nested paths (e.g., `src/index.ts`), it synthesizes a *separate* folder node for `src` with `children: []`. The folder lookup (`n.name === folderName && n.children`) doesn't match the earlier leaf because it has no `children` property.

**Fix**: One-line filter in `useWorkspaceFiles.ts`:

```typescript
const built = buildFileTree(files.filter((f) => !f.isDirectory));
```

The unfiltered `files` array is still stored in cache, preserving `isDirectory` metadata for potential future consumers.

**Tests added**:

- `useWorkspaceFiles.test.ts`: New test case with mixed directory + file entries (matching real GitHub API output), asserting no duplicate folder nodes in the resulting tree.
- `buildFileTree.test.ts`: New test documenting the duplicate-node behavior when directory entries are not pre-filtered, making the caller contract explicit.

## Benefits

- Workspace file tree renders each directory exactly once with correct folder semantics
- Fix applies to both web (GitHub lister) and desktop (Tauri lister) through the shared `useWorkspaceFiles` hook
- No changes to `buildFileTree` contract -- callers provide clean input, matching `SkillFileBrowser` precedent
- Test coverage now explicitly documents the filtering contract

## Impact

- **Users**: All Stigmer Console and Desktop users who browse workspace files in sessions
- **SDK consumers**: Platform builders using `useWorkspaceFiles` hook get correct tree output
- **Files changed**: 3 (1 fix, 2 test files)

## Related Work

- `SkillFileBrowser` already applied this pattern at its call site -- this fix brings workspace files in line
- The `_investigations` directory appearing is a separate product decision (no ignore-pattern filtering exists)

---

**Status**: Production Ready
