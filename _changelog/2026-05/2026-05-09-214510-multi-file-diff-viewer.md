# Multi-File Diff Viewer for Skill Versions

**Date**: May 9, 2026

## Summary

Built a GitHub-PR-like multi-file diff viewer for comparing two skill versions. The user selects two versions in the VersionTimeline, a dialog opens showing all changed files with per-file unified diffs, summary statistics, and file navigation. The generic diff infrastructure lives in `version-history/` (reusable for future Agent/MCP versioning); skill-specific artifact fetching and the dialog live in `skill/`.

## Problem Statement

Skill version history (T05-C) shows what versions exist and when they were pushed, but provides no way to see what actually changed between versions. Platform builders and operators need to understand the impact of a version before rolling back or approving a deployment.

### Pain Points

- No way to compare two skill versions — users must manually download ZIPs and diff locally
- VersionTimeline compare mode existed structurally (onCompare callback) but had no UI feedback when a selection was in progress
- The artifact fetch/unzip logic was duplicated between useSkillArtifact and any future diff hook
- No diff-specific design tokens — diff viewers would need to hardcode colors or use semantic tokens not designed for diffs

## Solution

End-to-end diff pipeline: theme tokens → shared artifact utility → diff computation → diff UI components → skill-specific hook → dialog → wired into SkillDetailView. Every layer is independently reusable.

## Implementation Details

### Theme Tokens (sdk/theme)

Six new `--stgm-diff-*` CSS custom properties for both light and dark modes:
- `added-bg` / `added-fg` — subtle green background and text for added lines
- `removed-bg` / `removed-fg` — subtle red background and text for removed lines
- `hunk-header-bg` / `hunk-header-fg` — subtle blue for hunk separator bars (`@@ -1,5 +1,7 @@`)

Mapped in Tailwind via `--color-diff-*` in `@theme inline` block. Presets inherit from `tokens.css` — diff colors carry universal semantic meaning (green=added, red=removed) and don't need per-preset overrides.

### Shared Artifact Utility (skill/internal)

Extracted `fetchAndUnpackArtifact()` from `useSkillArtifact` into `skill/internal/fetchAndUnpackArtifact.ts`. Returns `{ files, contentMap }` — consumed by both the existing `useSkillArtifact` (refactored, zero regression) and the new `useSkillDiff`.

### Diff Computation (version-history)

- `computeDiff()` — wraps jsdiff `structuredPatch()`, returns typed `DiffHunk[]` with per-line numbers and change types
- `computeMultiFileDiff()` — set arithmetic on two `Map<path, content>`, categorizes files as added/removed/modified, sorts SKILL.md first then by change type then alphabetically
- Types: `DiffLine`, `DiffHunk`, `FileDiffEntry`, `MultiFileDiffResult`, `DiffViewMode`

### Diff UI Components (version-history)

- `DiffViewer` — semantic `<table>` with line numbers, `+`/`-` text indicators alongside color (color is never the sole channel), ARIA labels, hunk separator headers
- `DiffFileList` — file list with M/A/D badges, `+N -N` counts, keyboard navigable buttons
- `DiffSummary` — "N files changed, +X additions, -Y deletions" live region for screen readers
- `MultiFileDiffView` — composes all three with file selection state, empty state with icon

### Skill Diff Hook (skill)

- `useSkillVersions` extended with `getArtifactKey(versionHash)` — builds internal `Map<hash, key>` from raw proto data, non-breaking addition to return type
- `useSkillDiff(fromKey, toKey)` — fetches two artifacts in parallel via shared utility, computes multi-file diff, includes 10MB combined size guard

### SkillDiffDialog (skill)

Native `<dialog>` with `showModal()` (consistent with existing `ConfirmDialog` pattern). Header shows "Comparing `hash-a` → `hash-b`" with close button. Loading skeleton, error via `ErrorMessage`, diff content via `MultiFileDiffView`. Backdrop click and Escape to close.

### Compare-Mode UX (version-history)

Enhanced `VersionTimeline` with compare-mode feedback:
- Info bar: "Select another version to compare with `hash`" + Cancel button, dashed primary border, compare icon
- First-selected entry: dashed border, `primary-subtle` background, "A" badge
- New `isCompareSource` prop on `VersionTimelineEntryProps` for distinct visual treatment

### Wiring (skill/SkillDetailView)

`onCompare` callback passed to `VersionTimeline`. When two versions are selected: look up artifact keys via `getArtifactKey()`, open `SkillDiffDialog` with keys and labels. Dialog manages its own data fetching lifecycle.

## Benefits

- **Users can now compare any two skill versions** directly from the version timeline — no external tools needed
- **Generic diff infrastructure** (`computeDiff`, `computeMultiFileDiff`, `DiffViewer`, `MultiFileDiffView`) is reusable for future Agent and MCP Server versioning
- **Accessibility**: color + text indicators, ARIA labels, keyboard navigation, native dialog focus trap
- **Theme-aware**: all diff colors flow through design tokens, automatically respect light/dark mode and presets
- **Maintainable**: shared `fetchAndUnpackArtifact` eliminates duplication, pure computation functions are independently testable

## Impact

- **SDK consumers**: 10 new exports (4 components, 2 pure functions, 4 types) available from `@stigmer/react`
- **Console users**: Compare button appears automatically in the Versions tab of any skill with version history
- **Platform builders**: Can compose `DiffViewer` + `computeDiff` independently for custom diff UIs
- **Theme**: 6 new `--stgm-diff-*` tokens available for any diff-related styling

## Related Work

- T05-C: Skill Version Timeline — prerequisite, provides the VersionTimeline and version data
- T05-B: Agent Dependency Graph — sibling feature in the same Phase 4 effort
- T05-A: Detail Page Tabbed Infrastructure — foundation enabling the Versions tab

---

**Status**: ✅ Production Ready
**Timeline**: Single session (Session 15)
