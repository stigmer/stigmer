# Detail page tab infrastructure for Agent and Skill detail views

**Date**: May 9, 2026

## Summary

Phase 4 task T05-A adds extension hooks so `AgentDetailView` and `SkillDetailView` can show a proper tab strip when consumers supply extra tabs (for example Dependencies and Versions in upcoming work), while preserving today’s single-column layout when no extensions are passed.

## Problem Statement

`ResourceDetailShell` already supported optional tabs, but neither agent nor skill detail views wired them. Dependency graphs and version timelines needed a stable shell-level place to mount without forking the SDK or duplicating layout.

### Pain Points

- No way for Console or embedders to add a second top-level tab without replacing the whole detail view.
- Future T05-B/T05-C needed a consistent API for tab metadata plus panel content.
- Tab UX should stay minimal when only one logical panel exists (no empty “Overview-only” chrome).

## Solution

Introduce `AdditionalTab` (`TabItem` plus `content`), an internal `useDetailTabs` hook for shared behavior, and new optional props on both detail views. Built-in tabs are **Overview** (agent) and **Content** (skill). When `additionalTabs` is absent or empty, the hook suppresses the tab list so the UI matches the previous scroll layout.

## Implementation Details

- **`sdk/react/src/resource-detail/types.ts`**: `AdditionalTab` interface with documented example for consumers.
- **`sdk/react/src/resource-detail/useDetailTabs.ts`**: Uncontrolled default (`useState`); controlled mode only when both `activeTab` and `onTabChange` are set; `effectiveTabs` is `undefined` when total tab count ≤ 1.
- **`AgentDetailView`**: Passes `tabs` / `activeTab` / `onTabChange` / `tabsAriaLabel` into `ResourceDetailShell` when extensions exist; renders `additionalTab.content` or existing `AgentOverview`.
- **`SkillDetailView`**: Same pattern; `SkillOverview` holds tag row, file browser or SKILL.md section, and version metadata block.
- **Root barrel**: Exports `AdditionalTab` type alongside existing resource-detail exports.

## Benefits

- Platform builders get zero-config behavior; advanced hosts get controlled tabs for URL sync.
- T05-B can mount `DependencyGraph` via `additionalTabs` without new SDK forks.
- Keyboard-accessible tab strip reuses existing `Tabs` / `ResourceDetailShell` integration.

## Impact

- **Consumers of `@stigmer/react`**: New optional props and type export; no breaking changes.
- **Stigmer Console**: No page changes required until Dependencies/Versions tabs are wired.

## Related Work

- Project plan: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T05_0_plan.md` (T05-A).
- Next: T05-B Agent dependency graph; T05-C Skill version timeline (backend RPC).

---

**Status**: Production ready (SDK surface; downstream tabs ship with later tasks)

**Timeline**: Single implementation session (T05-A scope)
