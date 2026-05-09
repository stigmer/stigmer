# Next Task: 20260508.02.resource-views-ux-overhaul

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260508.02.resource-views-ux-overhaul

**Description**: Transform Stigmer's resource management screens from basic read-only views into state-of-the-art operational hubs. Covers all resource types: Agents, Skills, MCP Servers, Runners, and Settings — with rich list workbenches, tabbed detail pages, manual+AI creation flows, version history, and cross-cutting UX improvements like command palette, keyboard shortcuts, and improved empty states.
**Goal**: Redesign and rebuild all resource management screens in @stigmer/react SDK and the Console to match the quality of best-in-class developer platforms (Vercel, Linear, Supabase, Stripe). Replace the current read-only library views and flat detail pages with a Resource Workbench pattern (table/card/list views, filters, sort, bulk actions, split inspector), tabbed operational detail hubs, dual-path creation (manual forms + AI sidecar), and foundational UX primitives (command palette, action menus, version timelines, dependency graphs).
**Tech Stack**: TypeScript, React 19, @stigmer/react SDK, @stigmer/theme, Tailwind CSS v4, @connectrpc/connect (gRPC), @bufbuild/protobuf, TanStack Table, TanStack Virtual, Radix/React Aria, cmdk, CodeMirror 6, Sonner
**Components**: sdk/react (ResourceWorkbench, ResourceTable, ResourceCards, ResourceList, StatusBadge, FilterBar, ViewSwitcher, BulkActionBar, ResourceInspector, plus all Phase 0 primitives), client-apps/web (library pages, settings pages, runners page, app shell, sidebar), sdk/theme (design tokens, status tokens)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-05-09 — Phase 1 Resource Workbench complete
- **Active Task**: Phase 1 complete. Next up: Phase 2 (Detail Pages as Operational Hubs)

## Session Progress (2026-05-09, Session 2)

- Completed full Phase 1 implementation (T02, all 9 sub-tasks)
- Built headless-first ResourceWorkbench architecture in `sdk/react/src/resource-workbench/`
- Added TanStack Table as optional peer dependency (MIT, DD-012 compliant)
- Created 3 headless hooks: `useResourceCollection`, `useResourceFilters`, `useResourceSelection`
- Created `useViewPreference` for persisted view mode in localStorage
- Built `StatusBadge` component using `--stgm-status-*` Phase 0 tokens (dot + text, never color alone)
- Built `ResourceTable` (TanStack Table rendering), `ResourceCards`, `ResourceList` view components
- Built `FilterBar` (removable filter chips), `ViewSwitcher` (table/cards/list toggle), `BulkActionBar` (floating selection bar)
- Built `ResourceInspector` split-panel and `ResourceWorkbench` shell composing all parts
- Migrated all 3 Console list pages (Agents, Skills, MCP Servers) from `ResourceListView` to `ResourceWorkbench`
- Marked old `ResourceListView` as `@deprecated`
- Exported all new hooks, components, and types from `sdk/react/src/index.ts`
- All typechecks and lint pass clean across both `@stigmer/react` and `client-apps/web`

## Key Decisions Made (This Session)

- **DD-T02-001**: Replace, don't evolve. Built ResourceWorkbench from scratch rather than extending the monolithic ResourceListView, since no external consumers exist yet and it violates DD-003 (headless-first).
- **DD-T02-002**: TanStack Table adopted as the table state kernel. MIT-licensed, headless, tree-shakeable. Added as optional peer dependency.
- **DD-T02-003**: URL state via callback props (`onStateChange`), not internal router coupling (DD-004 compliance). Zero `next/*` imports in the SDK.
- **DD-T02-004**: Three adoption tiers: hooks-only, view components, full `<ResourceWorkbench />` shell. Platform builders choose their abstraction level.

## Next Steps

1. **Phase 2: Detail Pages as Operational Hubs** — Agent tabbed detail page, Skill detail with markdown/code view, MCP server detail with tools/auth/policy tabs, Runner full-page management
2. **Enhance ResourceWorkbench** — Add scope toggle integration (org/all), keyboard navigation for table rows, density preferences
3. **Wire real column data** — Status, visibility, tags, timestamps, relationship counts in table columns (requires richer `SearchResult` or separate metadata fetch)
4. **Saved views** — "Failed agents", "Public skills" etc. (requires backend API)

## Context for Resume

- Phase 1 plan is at `.cursor/plans/t02_resource_workbench_927d6980.plan.md`
- Phase 0 plan is at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T01_0_plan.md`
- Research report at `_projects/2026-05/20260508.02.resource-views-ux-overhaul/research.resource-views-ux-overhaul/04.report.gpt.md`
- The research report's Phase 2 roadmap (report line 1179) defines the Detail Pages deliverables
- `ResourceListView` is deprecated but still in the codebase — can be removed once all references are gone
- The new `resource-workbench/` module is the canonical resource collection architecture going forward

## Essential Files to Review

### 1. New Resource Workbench Module
```
sdk/react/src/resource-workbench/
  types.ts, index.ts
  hooks/useResourceCollection.ts, useResourceFilters.ts, useResourceSelection.ts, useViewPreference.ts
  components/ResourceWorkbench.tsx, ResourceTable.tsx, ResourceCards.tsx, ResourceList.tsx,
            FilterBar.tsx, ViewSwitcher.tsx, BulkActionBar.tsx, ResourceInspector.tsx,
            StatusBadge.tsx, ColumnHeader.tsx, SelectionCheckbox.tsx
```

### 2. Migrated Console Pages
```
client-apps/web/src/domain/library/agents/AgentListPage.tsx
client-apps/web/src/domain/library/skills/SkillListPage.tsx
client-apps/web/src/domain/library/mcp-servers/McpServerListPage.tsx
```

### 3. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/checkpoints/
```

### 4. Project Documentation
- **README**: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/README.md`

## Knowledge Folders to Check

### Design Decisions
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/design-decisions/
```

### Coding Guidelines
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/coding-guidelines/
```

### Wrong Assumptions
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/wrong-assumptions/
```

### Don't Dos
```
_projects/2026-05/20260508.02.resource-views-ux-overhaul/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 2: Detail Pages as Operational Hubs

## Quick Commands

After loading context:
- "Continue with Phase 2" - Start the Detail Pages implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
