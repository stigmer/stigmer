# Next Task: 20260315.02.web-architecture-alignment

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Web Architecture & UX Alignment

**Description**: Close the architectural and UX gaps in Stigmer Web — adopt Query/Command hook pattern, Bridge IoC, error handling framework, domain library decomposition, clean up dead code, and bring the web console UX to state-of-the-art standards.

**Goal**: Bring Stigmer Web to the same level of architectural consistency as Planton Web **and** the same level of UX polish as Temporal's web console.

**Tech Stack**: TypeScript/React/Next.js 16

**Components**: `client-apps/web/src/` (hooks, services, components, layouts, pages), `client-apps/web/_libs/` (domain packages, rpc-client, theme)

**References**:
- Planton Web at `/Users/suresh/scm/github.com/plantonhq/planton/client-apps/web` — Query/Command hook pattern, Bridge IoC, domain library decomposition
- Temporal Web — UX benchmark for navigation IA, information density, visual identity, dark mode
- `_roles/006_ux_designer.md` — UX heuristics and mandates
- `_roles/004_web_ux_ui.md` — Web console design mandates

## Current State
- **Status**: IN PROGRESS
- **Last Session**: 2026-03-15 — Phase 1 completed (T01 + T02)
- **Active Task**: None — T03 complete, ready for T04
- **Next Task**: T04 (Visual Identity & Theme System)

## Session Progress (2026-03-15)

### Phase 1: Dead Code Removal & Tooling — COMPLETED

**T01: Dead Code Removal**
- Deleted `src/components/ui/tooltip.tsx` (zero imports)
- Deleted `src/components/ui/textarea.tsx` (duplicated by `_libs/domain/react-ui`)
- Removed dead re-exports from `transport.ts`: `Client`, `createClient`
- Removed dead exports from `search-service.ts`: `ApiResourceKind`, `SearchResponse`, `SearchResult`, `searchSkills`, `searchMcpServers`
- Removed unused `formatDateTime` from `src/lib/time.ts`
- Fixed routing bug: dashboard "Browse Catalog" was linking to `/agents` instead of `/catalog`

**T02: Prettier & ESLint Hardening**
- Installed `prettier` + `prettier-plugin-tailwindcss`
- Created `.prettierrc` and `.prettierignore`
- Added `format` and `format:check` scripts to `package.json`
- Hardened ESLint: `@typescript-eslint/no-unused-vars` and `@typescript-eslint/no-explicit-any` as errors
- Added `**/dist/**` to ESLint ignores (build artifacts were triggering violations)
- Applied Prettier formatting across entire codebase (80 files touched)

**Verification**: `npm run build`, `npm run lint`, and `npm run format:check` all pass cleanly.

### Key Decisions Made
1. **Kept OidcConfig and getIamApiAudience()** — they are future stubs for Auth0 integration
2. **Kept chart CSS variables** (--color-chart-1 through 5) — reserved for future chart/visualization features
3. **Kept Auth barrel re-exports and shadcn component variants** — part of public API surface / standard component primitives
4. **searchAgents was NOT dead code** — initial analysis flagged it incorrectly; `useAgentSearch.ts` depends on it. Caught by build verification.

### Surprise Encountered
- `searchAgents` was initially removed alongside the genuinely dead `searchSkills` and `searchMcpServers`. Build failure revealed `useAgentSearch.ts` imports it. The function was immediately restored. Lesson: always verify each removal individually, not in batches.

## Next Steps
1. ~~**T03: Package Rename** (`@stigmer/react-ui` → `@stigmer/agent-execution-ui`)~~ — **DONE**
   - Renamed directory `_libs/domain/react-ui/` → `_libs/domain/agent-execution-ui/`
   - Updated `package.json` name field
   - Updated all imports across the console
   - Updated workspace references and build scripts
   - Added `**/dist/` to `.prettierignore` (pre-existing oversight)
2. **T04: Visual Identity & Theme System**
   - Replace monochrome `oklch(0 0 0)` palette with brand-informed color system
   - Dark mode activation with theme toggle
   - Typography audit for Geist Sans/Mono hierarchy

## Context for Resume
- Phase 1 is fully committed and verified
- No work-in-progress or half-finished changes
- The codebase now has Prettier + hardened ESLint as a baseline for all future work
- T03 is complete — package renamed to `@stigmer/agent-execution-ui`
- T04 involves design decisions (brand color choice) — collaboration needed

## Gap Analysis Summary

The project addresses gaps from two analyses:
- [Architecture gap analysis](24cd7e58-4eb7-4af1-9c91-3bd01fbe6cab) — Planton Web comparison
- UX gap analysis — Temporal comparison against Nielsen heuristics

### Architecture Gaps
1. ~~**Dead Code**: 45 unused exports, 3 dead files, 5 unused CSS vars, 1 routing bug~~ — **DONE** (Phase 1)
2. ~~**Tooling**: No Prettier, no pre-commit hooks, ESLint rules too permissive~~ — **DONE** (Phase 1)
3. ~~**Naming**: `@stigmer/react-ui` contains only execution domain — renamed to `@stigmer/agent-execution-ui`~~ — **DONE**
4. **Architecture**: No Query/Command hook pattern (CQRS on frontend), no Bridge IoC beyond transport, no error handling framework
5. **Domain Libraries**: Only 1 domain package vs Planton's 10+ — everything else is in the console

### UX Gaps
6. **Visual Identity**: Monochrome gray palette — no brand color, no visual hierarchy through color (Nielsen #8)
7. **Dark Mode**: Tokens defined but no toggle or activation (Jakob's Law — dev tools default to dark)
8. **Navigation IA**: Sidebar has 4 items, hides product surface area; dual paths to resources (Nielsen #4, #6)
9. **Global Header Missing**: No user profile, no global search, no notifications, no settings access (Nielsen #1)
10. **Sessions Page Empty**: Renders `<div />` — complete dead end (Nielsen #1)
11. **Dashboard Lacks Status**: Shows actions but no system state — active executions, failures, pending approvals (Nielsen #1)
12. **Information Density**: Cards-only layout, no table view for power users (Nielsen #7)
13. **No Breadcrumbs**: No hierarchical navigation trail on detail pages (Nielsen #3)
14. **Workflow Views Missing**: Entire product pillar absent from web console
15. **IAM/Settings Missing**: No self-service org management, API keys, or team management

## Plan Structure (9 Phases, 21 Tasks, ~26 Days)

| Phase | Days | Focus | Type | Status |
|-------|------|-------|------|--------|
| Phase 1 | 1–2 | Dead code removal + Prettier + lint hardening | Architecture | **DONE** |
| Phase 2 | 3–4 | Package rename + Visual identity foundation | Architecture + UX | Next |
| Phase 3 | 5 | Navigation IA design decision (no code) | UX | Pending |
| Phase 4 | 6–9 | Query/Command hook pattern + service reorganization | Architecture | Pending |
| Phase 5 | 10–11 | Error handling & Bridge framework | Architecture | Pending |
| Phase 6 | 12–16 | Layout overhaul + View completeness (sidebar, header, sessions, dashboard) | UX | Pending |
| Phase 7 | 17–19 | Domain library extraction (`session-ui`, `catalog-ui`) | Architecture | Pending |
| Phase 8 | 20–24 | Workflow & IAM views (deferrable) | UX | Pending |
| Phase 9 | 25–26 | Final polish & verification | Both | Pending |

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260315.02.web-architecture-alignment/checkpoints/2026-03-15-session-1.md
```

### 2. Current Task Plan
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260315.02.web-architecture-alignment/tasks/T01_0_plan.md
```

### 3. All Tasks
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260315.02.web-architecture-alignment/tasks/
```

### 4. Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260315.02.web-architecture-alignment/README.md
```

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260315.02.web-architecture-alignment/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260315.02.web-architecture-alignment/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260315.02.web-architecture-alignment/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260315.02.web-architecture-alignment/dont-dos/
```

## Key Reference Files

### Architecture (Planton Web — Phases 4-5)

- **Query/Command hooks**: `planton/client-apps/web/_libs/domain/*/` — look at any `_services/` folder for `use*Query` and `use*Command` patterns
- **Bridge pattern**: `planton/client-apps/web/console/src/components/providers/` — `PlantonServiceBridge`, `CloudResourceCrudBridge`
- **RPC client IoC**: `planton/client-apps/web/_libs/infra/rpc-client/` — `PlantonServiceContext`, `useRpcClient`, `usePlantonService`
- **Error handling**: `planton/client-apps/web/_libs/infra/rpc-client/` — interceptors, event buses, error scopes
- **Domain library structure**: `planton/client-apps/web/_libs/domain/` — each domain is its own publishable package

### UX Benchmarks (Phases 2, 3, 6)

- **Temporal Web UI** — navigation IA, sidebar taxonomy, table layouts, dark mode, information density
- **Stigmer role mandates**: `_roles/006_ux_designer.md` (cross-surface UX), `_roles/004_web_ux_ui.md` (web console UX/UI)
- **Theme tokens**: `client-apps/web/_libs/ui/theme/src/tokens.css` — the palette to update in Phase 2
- **Navigation config**: `client-apps/web/src/config/navigation.ts` — the sidebar to rebuild in Phase 6

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/2026-03-15-session-1.md`
2. [ ] Check current task status — Phase 1 complete, Phase 2 next
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with T03 (Package Rename) or T04 (Visual Identity)

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260315.02.web-architecture-alignment/next-task.md`

---

**Created**: 2026-03-15
**Updated**: 2026-03-15
**Current Task**: Phase 2 — T04 (Visual Identity & Theme System)
**Status**: READY — T03 complete, T04 next

---

*This file provides direct paths to all project resources for quick context loading.*
