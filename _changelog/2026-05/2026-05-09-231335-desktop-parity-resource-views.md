# Desktop Parity: Resource Views UX Overhaul

**Date**: May 9, 2026

## Summary

Closed the systemic desktop app parity gap that accumulated across 16 sessions of the resource-views-ux-overhaul project. All SDK components built in Phases 0-4 (ResourceWorkbench, action bars, creation wizards, import/export, confirm dialogs) are now properly wired in the desktop app, matching the web app feature-for-feature. Also fixed web-side delete TODOs and deleted the deprecated `ResourceListView` from the SDK.

## Problem Statement

The resource-views-ux-overhaul project delivered substantial SDK components across Phases 0-4, but a review revealed the desktop app was entirely untouched — a direct violation of DD-016 (Client App Parity) and Dont-Do #9 (no single-client-app fixes for shared SDK wiring).

### Pain Points

- Desktop list pages used the deprecated `ResourceListView` instead of `ResourceWorkbench` — no table view, no column definitions, no view mode switcher, no action menus
- Desktop detail pages had no action bars — no copy, export, or delete flows
- Desktop had zero creation routes — still routing to `/?draft=*` instead of wizard flows
- No import/export capability on desktop
- No runner detail drill-down from fleet rows
- Desktop missing `FetchCacheProvider` for cross-mount data persistence
- Web list pages had unresolved TODO stubs for delete actions

## Solution

Treated the desktop parity gap as a single focused implementation task. All SDK components already existed — this was purely consumer-level wiring adapted for React Router (vs Next.js on web).

## Implementation Details

**Desktop list pages (3 files rewritten):**
- `AgentListPage`, `SkillListPage`, `McpServerListPage` — migrated from `ResourceListView` to `ResourceWorkbench` with table/cards view modes, `ActionMenu` per item (view details, copy ID, delete with confirmation), scope toggle, and search
- Agent and MCP Server list pages include `ImportResourceDialog`
- All "create" buttons route to `/library/*/new`

**Desktop detail pages (3 files rewritten):**
- `AgentDetailPage` — full action bar with Edit (primary), Copy ID, Copy slug, Export YAML/JSON, Download YAML, Delete with `ConfirmDialog`
- `SkillDetailPage` — Copy ID, Copy slug, Delete with confirmation
- `McpServerDetailPage` — full action bar matching Agent pattern

**Desktop creation pages (3 new files):**
- `AgentNewPage` — `CreationPicker` → `AgentCreationWizard` with template/import support
- `SkillNewPage` — `SkillUploader` with navigation callbacks
- `McpServerNewPage` — `CreationPicker` → `McpServerCreationWizard`

**Desktop runner detail (1 new file + 2 modified):**
- `RunnerDetailPage` — `RunnerDetailView` with stop/delete actions
- `OrgFleetSection` — added `onViewDetail` callback for fleet row click-through
- `RunnersPage` — wired navigate to `/runners/:id`

**Route changes:**
- 3 creation routes: `agents/new`, `skills/new`, `mcp-servers/new`
- 1 runner detail route: `runners/:id`
- All placed before `:org/:slug` params for correct matching

**Infrastructure:**
- `FetchCacheProvider` added to desktop `App.tsx`
- DD-004 clarified: `"use client"` is a React standard directive

**Cleanup:**
- `ResourceListView.tsx` deleted (943 lines removed)
- Barrel exports removed from `library/index.ts` and `sdk/react/src/index.ts`

**Web fixes:**
- `AgentListPage` and `SkillListPage` delete TODOs resolved with `useConfirmAction` + `ConfirmDialog` + `key`-based workbench refresh

## Benefits

- Desktop users now have full feature parity with web for all resource management operations
- `FetchCacheProvider` enables instant render from cache on page transitions
- Fleet rows are now clickable for runner detail drill-down
- 943 lines of deprecated code removed from the SDK
- DD-016 (Client App Parity) compliance restored

## Impact

- **Desktop app**: 6 pages rewritten, 4 new pages, 4 new routes
- **Web app**: 2 list pages fixed (delete actions)
- **SDK**: 1 component deleted, barrel exports cleaned
- **Architecture rules**: DD-004 clarified

## Related Work

- [Agent Dependency Graph](_changelog/2026-05/2026-05-09-203840-agent-dependency-graph.md)
- Project: `_projects/2026-05/20260508.02.resource-views-ux-overhaul`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (Session 17)
