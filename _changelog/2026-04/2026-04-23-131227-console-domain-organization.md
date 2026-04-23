# Console Domain Organization — Workstream B Complete

**Date**: April 23, 2026

## Summary

Restructured `client-apps/web/src/` from a technical-function layout (`components/`, `contexts/`, `hooks/`, `utils/`) to a domain-organized layout (`domain/session/`, `domain/settings/`, `domain/library/`, `domain/_shared/`). The file tree now answers "which product area does this belong to?" at a glance. 52 files moved across 9 incremental phases with zero lint regressions and all baseline architectural metrics unchanged.

## Problem Statement

The Console's source tree grouped files by technical role — all hooks in `hooks/`, all contexts in `contexts/`, all components in `components/` with feature subfolders. This organization makes it hard to reason about domain boundaries. A developer looking for session-related code has to check four directories; a new contributor can't tell at a glance which product area a file serves.

### Pain Points

- **Cross-boundary imports**: `AppShell.tsx` imported `SessionPage` from `@/app/sessions/[id]/SessionPage` — a layout component reaching into a route directory.
- **Misleading placement**: `components/auth/Providers.tsx` was the full root provider graph (theme, query, auth, transport, org), not an auth-specific component. `components/auth/OrgGate.tsx` was org-tenancy infrastructure, not auth.
- **Technical-function grouping**: `hooks/`, `contexts/`, `utils/` mixed concerns from session, library, and settings into single directories. DD-005 (Dont-Do #5) explicitly prohibits this pattern.
- **Colocated domain logic in routes**: `app/library/` contained `AgentListPage.tsx`, `LibraryLanding.tsx`, and other feature components alongside route files, violating DD-002 (Console is a thin shell).

## Solution

Introduced `src/domain/` with subdirectories mirroring the Console's product areas (session, settings, library) plus `_shared/` for cross-domain infrastructure (layout, org context, UI primitives, hooks). Extracted `providers/` as a top-level directory for the root provider composition. Kept `auth/` and `config/` top-level as self-contained infrastructure modules.

## Implementation Details

Executed in 9 phases, each verified with `npm run lint -w client-apps/web` before proceeding:

| Phase | What Moved | Files | Key Detail |
|-------|-----------|-------|------------|
| 1 | providers/ | 2 | Providers.tsx, StigmerTransportBridge — lowest blast radius |
| 2 | domain/_shared/ui/ | 14 | shadcn-style primitives — zero `@/` deps, mechanical move |
| 3 | domain/_shared/hooks/ | 2 | useDeploymentMode, useStaticRouteParam |
| 4 | domain/_shared/org/ | 2 | org-context (~21 import updates), OrgGate — highest fan-in |
| 5 | domain/_shared/layout/ | 7 | AppShell, Sidebar, ManagementSidebar, OrgSwitcher, UserMenu |
| 6 | domain/settings/ | 11 | All *Section.tsx panels + ComingSoon |
| 7 | domain/session/ | 4 | SessionPage, SessionLauncher, session-navigation, draft-session — fixes AppShell cross-boundary import |
| 8 | domain/library/ | 10 | Library pages + navigation, with agents/, skills/, mcp-servers/ subdirs |
| 9 | Cleanup | 0 | Removed empty dirs, wrote domain/README.md, full verification |

### Architectural decisions

- **`auth/` stays top-level**: Already self-contained with its own barrel export (`index.ts`). It's infrastructure, not a product area — moving to `domain/auth/` would add depth without clarity.
- **`config/` stays top-level**: Same rationale — app infrastructure consumed globally.
- **`domain/library/` preserves resource-type subdirs**: `agents/`, `skills/`, `mcp-servers/` mirror the route structure for navigability as the library grows.
- **`InvitePageClient.tsx` stays colocated in `app/`**: Single-use file with no reuse — moving it would add structure without value.
- **`settings-nav.ts` stays in layout**: Consumed by both `ManagementSidebar` (layout) and `settings/page.tsx` (route). Keeping with layout avoids cross-domain imports.

## Benefits

- **Domain boundaries visible in the file tree**: New contributors can identify which product area a file serves without reading imports.
- **Cross-boundary import smell fixed**: `AppShell` now imports `SessionPage` from `@/domain/session/SessionPage` instead of reaching into `app/sessions/[id]/`.
- **Dont-Do #5 enforced structurally**: Technical-function directories (`hooks/`, `contexts/`, `utils/`, `components/`) eliminated — code is organized by domain, not by role.
- **`app/` is routes only**: All domain logic extracted; route files are thin wiring to `domain/`.
- **Zero metric degradation**: All five baseline architectural metrics verified unchanged after restructuring.

## Impact

- **Console developers**: Clear placement rules — new code goes into the appropriate `domain/` subdirectory, not into catch-all directories.
- **SDK contributors**: No changes — this restructuring is Console-only. Zero changes to `@stigmer/react`, `@stigmer/sdk`, or `@stigmer/theme`.
- **Future refactoring**: The domain structure makes it straightforward to identify candidates for SDK extraction (DD-001) — any component in `domain/` that proves useful to platform builders can be cleanly moved to `@stigmer/react`.

## Related Work

- **Workstream A**: Design decisions DD-001 through DD-008 and Dont-Dos 001–005 — the rules this restructuring enforces structurally.
- **Workstream C**: Baseline metrics and ESLint boundary enforcement — the verification framework used to confirm zero degradation.
- Cursor rule `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` — Dont-Do #5 already referenced `src/domain/session/` as the target pattern.

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour), 9 incremental phases
