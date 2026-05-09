# Detail Pages as Operational Hubs (Phase 2)

**Date**: May 9, 2026

## Summary

Transformed all four resource detail views (Agent, Skill, MCP Server, Runner) from read-only configuration displays into operational hubs with action bars, clipboard actions, confirmation-gated destructive operations, and a source/rendered toggle for skill content. Introduced the `ResourceDetailShell` SDK primitive and promoted the internal `Tabs` component to a public API.

## Problem Statement

Detail pages across the Stigmer Console were passive — users could view a resource's configuration but could not act on it. Every operation (edit, delete, copy ID) required navigating away or using external tools.

### Pain Points

- No action affordances on any detail page (except a lone "Edit" link on agents)
- No way to copy resource IDs or slugs from the UI
- No delete capability from detail pages
- Skills showed rendered markdown with no way to view the raw SKILL.md source
- Runners had no detail page at all — only a list panel
- The well-built internal `Tabs` component was not available to platform builders

## Solution

Built a layered SDK-first architecture following the established design decisions (DD-001 SDK-first, DD-003 headless-first, DD-004 zero framework deps):

1. **ResourceDetailShell** — shared layout primitive (header + action bar + optional tabs)
2. **ResourceActionBar** — primary action button + kebab overflow menu using the existing `ActionMenu` compound component
3. **Headless hooks** — `useCopyResource`, `useConfirmAction`, `useDeleteResource` for clipboard, confirmation, and mutation flows
4. **ConfirmDialog** — accessible modal using native `<dialog>` for destructive action confirmation
5. **Tabs promotion** — moved from `internal/Tabs.tsx` to `tabs/Tabs.tsx` as a public export

## Implementation Details

### New SDK module: `resource-detail/`

- `types.ts` — `DetailAction`, `ResourceHeaderMeta`, `ConfirmOptions`, `ConfirmState`
- `ResourceDetailShell.tsx` — layout shell (header with status badge, action bar, optional tab strip, content area)
- `ResourceActionBar.tsx` — primary action button + grouped kebab overflow
- `useCopyResource.ts` — clipboard with fallback + toast feedback
- `useConfirmAction.ts` — imperative `confirm()` → `Promise<boolean>` pattern
- `useDeleteResource.ts` — generic over agent/skill/mcpServer/runner, wraps per-type delete RPCs
- `ConfirmDialog.tsx` — native `<dialog>` with focus trap, Escape, backdrop

### Refactored detail views

- **AgentDetailView** — old inline `Header` replaced by `ResourceDetailShell`, content sections extracted to `AgentOverview`, new `primaryAction`/`actions` props
- **SkillDetailView** — `ResourceDetailShell` wrapping, source/rendered toggle (Preview/Source radio group), `SkillState` → `StatusPhase` mapping for status badge
- **McpServerDetailView** — `ResourceActionBar` added alongside existing header (kept MCP-specific header intact — lowest-risk approach), new `primaryAction`/`actions` props
- **RunnerDetailView** — new component from scratch with status grid, machine info, `useRunner` hook (wraps `stigmer.runner.get`)

### Console page wiring

All four detail pages wire: Copy ID, Copy slug, Delete (with `ConfirmDialog`). Agent adds Edit as primary action. Runner adds Stop.

### Tabs promotion

`internal/Tabs.tsx` → `tabs/Tabs.tsx` as public export with `TabItem.icon` support. Old path re-exports with `@deprecated` marker. McpServerDetailView updated to import from new path.

## Benefits

- Every detail page now has a consistent action bar — users can act without navigating away
- Clipboard actions (Copy ID, Copy slug) reduce context-switching to dev tools
- Destructive operations are confirmation-gated — prevents accidental deletion
- Skill source toggle provides "Preview / Code" experience similar to GitHub
- Runners finally have a dedicated detail page with status visibility
- Platform builders can use `ResourceDetailShell`, `Tabs`, and all new hooks in their own embeddings

## Impact

- **SDK**: 8 new files in `resource-detail/`, 2 new files in `tabs/`, 2 new runner files. 15 new public exports.
- **Console**: 4 detail pages refactored, 1 new route (`/runners/[id]`)
- **Platform builders**: New composable primitives for building resource management UIs
- **Backward compatibility**: All existing public APIs preserved. `AgentDetailView`, `SkillDetailView`, `McpServerDetailView` accept new optional props — no breaking changes.

## Related Work

- Builds on Phase 0 (UX foundations — status tokens, empty states, action menus) and Phase 1 (ResourceWorkbench)
- Uses Phase 0's `StatusBadge` in `ResourceDetailShell` header
- Uses Phase 0's `ActionMenu` compound component in `ResourceActionBar`
- Research report: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/research.resource-views-ux-overhaul/04.report.gpt.md`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~45 minutes)
