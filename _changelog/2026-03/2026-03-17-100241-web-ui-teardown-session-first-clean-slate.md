# Web UI Teardown: Session-First Clean Slate

**Date**: March 17, 2026

## Summary

Removed all existing dashboard-centric UI from the Stigmer web console, leaving only the auth infrastructure, provider composition root, org context, shadcn/ui primitives, and build tooling. This is the foundation step for the session-first UX redesign (T01.3 of the `session-first-web-ux` project).

## Problem Statement

The existing web console was built around a dashboard-centric model: landing page with resource counts, resource listing pages (agents, skills, MCP servers, sessions), detail pages, and a draft/run flow. This architecture does not align with the new session-first UX where users land on a "New Session" launcher and immediately start working.

### Pain Points

- Incremental refactoring of the old UI would carry legacy patterns into the new design
- The old layout (sidebar navigation, dashboard, resource CRUD pages) is fundamentally different from the target three-panel session layout
- Old hooks, config, and utilities were tightly coupled to the dashboard model and not reusable

## Solution

Complete teardown: delete all UI-facing code and preserve only the infrastructure layer. This gives T01.4+ a clean growth trajectory without legacy influence.

## Implementation Details

**Deleted (~55 files, 3,931 lines removed):**
- `src/components/layout/` -- AppShell, Sidebar, AppHeader, TopBar, Breadcrumb, OrgSwitcher, UserMenu, ThemeToggle, ThemePresetSelector, useSidebarCollapse
- `src/components/dashboard/` -- QuickActions, RecentSessions, ResourceOverview
- `src/components/session/` -- SessionCard
- `src/components/resource-list/` -- ResourceList, ResourceEmptyState
- `src/components/draft/` -- DraftPage
- `src/components/skill/` -- SkillDetailView
- `src/components/mcp-server/` -- McpServerDetailView
- `src/hooks/` -- all domain hooks (agents, sessions, skills, mcp-servers, dashboard) and generic utilities (useDebouncedValue, useDynamicRouteId)
- `src/app/{run,draft,agents,skills,mcp-servers,sessions}/` -- all page routes
- `src/config/{navigation,draft}.ts` -- sidebar nav items and draft configs
- `src/utils/time.ts`

**Modified (2 files):**
- `src/app/layout.tsx` -- removed AppShell import and wrapper, trimmed metadata description
- `src/app/page.tsx` -- replaced dashboard with minimal server component placeholder

**Preserved (31 files):**
- `src/auth/` -- AuthProvider, AuthGuard, OIDC, token store, context, types, disabled mode
- `src/contexts/org-context.tsx` -- OrgProvider, useOrg, useActiveOrgSlug
- `src/components/auth/Providers.tsx` -- provider composition root
- `src/components/providers/StigmerTransportBridge.tsx` -- bridges console auth to @stigmer/sdk
- `src/components/ui/` -- 10 shadcn/ui primitives
- `src/config/env.ts`, error boundaries, globals.css, build config

## Benefits

- Clean starting point for T01.4 (App Shell) through T01.7 (Sidebar Recents)
- No legacy patterns or dead imports to work around
- Build compiles in 1.5s with zero errors and zero lint warnings
- Git history preserves all deleted code for reference (especially `run/page.tsx` which documents the `@stigmer/react` import patterns needed for T01.5/T01.6)

## Impact

- **Web console**: Renders a blank authenticated placeholder at `/`. No functional UI until T01.4.
- **Developer experience**: Any future work in `client-apps/web/` starts from a clearly defined 31-file foundation.
- **No dependency changes**: `package.json` untouched. Temporarily unused deps will be needed in upcoming tasks.

## Related Work

- T01.1: Seedpack Default Assistant Agent (completed, committed `ca2b2554`)
- T01.2: Backend Default Agent Resolution (in progress, separate conversation)
- T01.4: Web App Shell (next task -- three-panel layout)
- Project: `_projects/2026-03/20260317.01.session-first-web-ux`

---

**Status**: Production Ready
