# Next Task: 20260320.01.library-and-artifacts-flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260320.01.library-and-artifacts-flow

**Description**: Add Library page (agents, skills, MCP servers browsing) and Execution Artifacts widget with Stigmer resource detection and Apply-to-org flow in the web console, following the SDK-first architecture.
**Goal**: Enable users to browse, create, and manage Agents, Skills, and MCP Servers through the web console Library, with execution artifacts surfaced as reviewable/applyable resources in the session right sidebar.
**Tech Stack**: TypeScript, React 19, Next.js, @stigmer/react, @stigmer/sdk, @stigmer/theme, TanStack Query, Tailwind CSS
**Components**: @stigmer/react (hooks + components), client-apps/web (routing, pages, sidebar), @stigmer/sdk (resource clients), @stigmer/theme (design tokens)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260320.01.library-and-artifacts-flow/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-20 10:41
**Current Task**: T01 — Phase 1: Library Pages + Navigation (Foundation)
**Status**: In Progress

## Session Progress (2026-03-20, Session 1)

### Completed
- **T01.1 — `useAgentList` data hook**: Fully implemented and exported
  - Created internal `useResourceList` hook in `sdk/react/src/search/useResourceList.ts`
    - Pagination (offset-based `page`/`pageSize`), scope toggle (`"org"` | `"all"`), text query
    - Follows all established patterns: `useState`/`useEffect`, `cancelled.current`, `fetchKey` refetch
  - Created public `useAgentList` hook in `sdk/react/src/agent/useAgentList.ts`
    - Thin wrapper remapping `entries` → `agents` for domain-specific naming
  - Updated barrel exports in `search/index.ts`, `agent/index.ts`, `sdk/react/src/index.ts`
  - TypeScript check clean, zero lint errors

### Key Discoveries (from codebase exploration)
1. `AgentClient.list()` delegates to `SearchService.search()` — returns `SearchResult[]` projections, not full `Agent` resources. Correct for list views.
2. Pagination is offset-based (`{ num, size }`), not cursor-based as the T01_0_plan stated.
3. `useAgentSearch` already exists wrapping the same API — serves picker/type-ahead UX (debounced, page 1 only). `useAgentList` serves Library browse UX (externally-controlled params, pagination, scope).
4. Scope maps to `excludePublic` on `ListParams`: `"org"` → `excludePublic: true`, `"all"` → `excludePublic: false`.

### Design Decisions (recorded in `design-decisions/`)
- DD-001 through DD-005 were recorded during planning (pre-existing)

## Session Progress (2026-03-20, Session 2)

### Completed
- **T01.2 — `useSkillList` data hook**: Fully implemented and exported
  - Created `sdk/react/src/skill/useSkillList.ts` — thin wrapper over `useResourceList`
  - Returns `{ skills, totalCount, totalPages, currentPage, isLoading, error, refetch }`
  - Full JSDoc with `@link` cross-reference to `useSkillSearch`, usage examples
  - Updated barrel exports in `skill/index.ts`

- **T01.3 — `useMcpServerList` data hook**: Fully implemented and exported
  - Created `sdk/react/src/mcp-server/useMcpServerList.ts` — thin wrapper over `useResourceList`
  - Returns `{ mcpServers, totalCount, totalPages, currentPage, isLoading, error, refetch }`
  - Full JSDoc with `@link` cross-reference to `useMcpServerSearch`, usage examples
  - Updated barrel exports in `mcp-server/index.ts`

- **Barrel exports updated**: Both module-level and top-level `sdk/react/src/index.ts` barrel exports updated with new hooks and types

### Verification
- TypeScript check passes (8 pre-existing errors in unrelated test file, zero in new/modified files)
- Lint clean on all 5 files (2 new, 3 modified)
- All existing exports unchanged — no breaking changes

## Session Progress (2026-03-20, Session 3)

### Completed
- **T01.4 — Individual resource count hooks**: Fully implemented and exported
  - Created internal `useResourceCount` hook in `sdk/react/src/search/useResourceCount.ts`
    - Same `useState`/`useEffect`/`cancelled.current`/`fetchKey` pattern as `useResourceList`
    - Calls `list()` with `page: { num: 1, size: 1 }` for minimal payload — only reads `totalCount`
    - Does not store entries in state — simpler state footprint than `useResourceList`
  - Created three public wrapper hooks:
    - `sdk/react/src/agent/useAgentCount.ts` — wraps `stigmer.agent.list`
    - `sdk/react/src/skill/useSkillCount.ts` — wraps `stigmer.skill.list`
    - `sdk/react/src/mcp-server/useMcpServerCount.ts` — wraps `stigmer.mcpServer.list`
  - All return `{ count, isLoading, error, refetch }`
  - Full JSDoc with `@link` cross-references to corresponding list hooks, usage examples
  - Updated barrel exports in 5 files: `search/index.ts`, `agent/index.ts`, `skill/index.ts`, `mcp-server/index.ts`, `sdk/react/src/index.ts`
  - TypeScript check clean, zero lint errors

### Key Design Decision (from this session)
- **Individual count hooks over combined hook**: The original plan called for a single `useResourceCount` in `library/` returning `{ agentCount, skillCount, mcpServerCount }`. After analysis, individual hooks (`useAgentCount`, `useSkillCount`, `useMcpServerCount`) were chosen because:
  - Follows the exact same pattern as the list hooks (internal shared hook + thin wrappers)
  - More composable — platform builders who only need one count don't trigger unnecessary fetches
  - Independent loading/error states — one failing API doesn't block the others
  - Adding a 4th resource type is additive (new hook), not a breaking change
  - No new `library/` module needed for data hooks — data hooks stay in resource domains
  - The `library/` module (T01.5+) is reserved for cross-resource UI components

### Verification
- TypeScript check passes (8 pre-existing errors in unrelated test file, zero in new/modified files)
- Lint clean on all 9 files (4 new, 5 modified)
- All existing exports unchanged — no breaking changes

## Session Progress (2026-03-20, Session 4)

### Completed
- **T01.5 — `ScopeToggle` component**: Fully implemented and exported
  - Created `sdk/react/src/library/ScopeToggle.tsx` — first UI component in the Library feature
    - Controlled segmented control: `[Org] [All]` for toggling `ResourceListScope`
    - WAI-ARIA Radio Group pattern (`role="radiogroup"` + `role="radio"`) with roving tabindex
    - Keyboard: Arrow Left/Right/Up/Down navigates and selects, Tab enters/exits group
    - Styled via semantic Tailwind classes: `bg-muted` track, `bg-background shadow-sm` active pill
    - Uses `cn()` from `@stigmer/theme`, all visual properties flow through `--stgm-*` tokens
    - Props: `value: ResourceListScope`, `onChange`, `disabled?`, `className?`
    - Full JSDoc with usage example and `@see` cross-references to data hooks
  - Created `sdk/react/src/library/index.ts` — barrel exports for the new `library/` module
    - Exports `ScopeToggle`, `ScopeToggleProps`, re-exports `ResourceListScope` from `../search`
  - Updated `sdk/react/src/index.ts` — added Library section to top-level barrel
  - TypeScript check clean, zero lint errors

### Gap Fixed
- **`ResourceListScope` now exported from top-level barrel**: Previously only available from `search/index.ts`. Platform builders can now import it from `@stigmer/react` directly, which they need to type their scope state variables when using `ScopeToggle`.

### Architecture Decision (from this session)
- **Domain-specific `ScopeToggle` over generic `SegmentedControl<T>`**: A segmented control is a general UI primitive, but `ScopeToggle` is about the domain concept of resource scope. Building a generic `SegmentedControl` would be premature abstraction — adds API surface and maintenance cost without a concrete second use case. If needed later, extraction is straightforward.

## Session Progress (2026-03-20, Session 5)

### Completed
- **T01.6 — `ResourceListView` component**: Fully implemented and exported
  - Created `sdk/react/src/library/ResourceListView.tsx` (~430 lines, single file)
  - Paginated, searchable list view for browsing `SearchResult[]` resources
  - Progressive enhancement: only `items` + `isLoading` required; search, scope, pagination activate via optional props
  - Composes `ScopeToggle` in a search toolbar alongside a debounced search input (300ms)
  - Automatic page reset on search/scope changes to prevent stale pagination
  - Built-in default row renderer: kind icon, name, org, description, visibility badge ("Public"), tags (capped at 3 + "+N more")
  - 6 internal sub-components: SearchToolbar, DefaultResourceRow, SkeletonRows, EmptyState, ErrorState, PaginationBar
  - 8 inline SVG icons: Agent, Skill, MCP Server, Workflow, Document, Search, ChevronLeft, ChevronRight
  - Full accessibility: `role="list"` + roving tabindex + Arrow Up/Down keyboard nav + screen reader support
  - All styles via `--stgm-*` tokens, zero Console dependencies
  - Updated barrel exports in `library/index.ts`
  - TypeScript check clean, zero lint errors

### Key Design Decisions (from this session)
- **SearchResult-typed over generic `<T>`**: All three resource types return `SearchResult[]` — typing to this enables a useful default row renderer and avoids unnecessary abstraction
- **Component-managed debouncing**: The search input's raw value lives inside the component; parent only sees debounced values via `onSearchChange`. Uses stable callback refs so the timer doesn't reset on parent re-renders
- **Simple rows for Phase 1**: `SearchResult` lacks resource-type-specific metadata (version, dependency counts). Accepted simpler rows using available fields — enriched rows deferred to Phase 5
- **Pagination as Previous/Next**: No numbered page buttons (YAGNI for Phase 1)
- **Error/empty/skeleton states as siblings of list**: `role="list"` only wraps actual list items; states render as separate blocks for correct ARIA semantics

### Verification
- TypeScript check passes (8 pre-existing errors in unrelated test file, zero in new/modified files)
- Lint clean on all 3 files (1 new, 2 modified)
- All existing exports unchanged — no breaking changes
- Committed: `6fa4e8ff feat(sdk/react): add ResourceListView component for Library browsing`

## Session Progress (2026-03-20, Session 6)

### Completed
- **T01.7 — `ResourceCountCard` component**: Fully implemented and exported
  - Created `sdk/react/src/library/ResourceCountCard.tsx` (~160 lines, single file)
  - Card displaying resource type icon, count, and label for Library landing pages and dashboards
  - Purely presentational — data decoupled, consumer provides count via hooks
  - Polymorphic root element: `<a>` with `href`, `<button>` with `onClick`, `<div>` when static
  - Progressive loading: icon + label visible immediately, skeleton pulse for count only
  - `tabular-nums` on count for stable digit widths during live updates
  - `aria-label` on interactive variants for screen reader context
  - All styles via `--stgm-*` tokens, zero Console dependencies
  - Updated barrel exports in `library/index.ts` and `sdk/react/src/index.ts`
  - TypeScript check clean, zero lint errors

### Key Design Decisions (from this session)
- **Self-contained card over content-only**: Card chrome included because the card surface IS the interaction unit (unlike `ExecutionCostSummary` which is content-only). Matches `ApprovalCard` precedent.
- **Polymorphic root over single element type**: `<a>` for links (accessible: right-click, new tab), `<button>` for actions, `<div>` for static. Console wires SPA routing via `href + onClick(preventDefault)`.
- **Icons as `ReactNode`**: Consumer provides icons — component doesn't know which resource type it represents. Correct level of abstraction for platform builders.

### Verification
- TypeScript check passes (8 pre-existing errors in unrelated test file, zero in new/modified files)
- Lint clean on all 3 files (1 new, 2 modified)
- All existing exports unchanged — no breaking changes

## Session Progress (2026-03-20, Session 7)

### Completed
- **T01.9 — Sidebar update**: Added "Library" navigation link to Console sidebar
  - Imported `Library` icon from lucide-react
  - Added `isLibraryActive` derived from `pathname.startsWith("/library")` for active state on all `/library/*` routes
  - Library link grouped with "New Session" (Gestalt proximity principle), single separator before Recents
  - Active state: `bg-sidebar-accent text-sidebar-accent-foreground` with `aria-current="page"`
  - Updated `<nav>` `aria-label` from `"Sessions"` to `"Main navigation"`
  - 1 file changed, 20 insertions, 2 deletions
  - TypeScript check clean, zero lint errors

### Verification
- TypeScript check passes (zero errors in modified file)
- Lint clean
- All existing sidebar behavior preserved — no breaking changes

## Session Progress (2026-03-20, Session 8)

### Completed
- **T01.10 — Library landing page**: Created `/library` route in the Console
  - `client-apps/web/src/app/library/layout.tsx` — shared `max-w-4xl` container layout for all `/library/*` routes
  - `client-apps/web/src/app/library/page.tsx` — thin server component entry point
  - `client-apps/web/src/app/library/LibraryLanding.tsx` — client component composing three `ResourceCountCard` cards
  - Data-driven card config via `RESOURCE_CARDS` constant, SPA navigation via `href + onClick(preventDefault)`
  - Responsive grid: single column mobile, 3 columns `sm`+
  - "Create New" shortcuts deferred to Phase 3 (T03.3) — pre-fill infrastructure doesn't exist yet

- **Count hook initial state fix**: Changed `useResourceCount` and all public count hooks to return `count: number | undefined` (was `number`)
  - `useState(0)` → `useState<number | undefined>(undefined)` — "not yet loaded" vs "loaded, zero"
  - Enables `ResourceCountCard` skeleton display on first render
  - 4 SDK files modified

### Gap Discovered & Fixed
- **Count hook / card integration gap**: Hooks initialized `count: 0` but `ResourceCountCard` expected `undefined` for skeleton. Fixed at the hook level (correct semantic) rather than working around in consumer.

### Verification
- TypeScript check passes (zero errors in new/modified files)
- Lint clean on all 7 files (3 new, 4 modified)
- Committed: `7eb73af3 feat(sdk/react,web): add Library landing page and fix count hook initial state`

## Session Progress (2026-03-20, Session 9)

### Completed
- **T01.10 enhancements — Breadcrumbs + "Create New" shortcuts**: Enhanced the Library landing page
  - Created `client-apps/web/src/app/library/LibraryBreadcrumb.tsx` — pathname-based breadcrumb component
    - WAI-ARIA Breadcrumb pattern (`nav[aria-label="Breadcrumb"]` > `ol` > `li` > `aria-current="page"`)
    - Segment-to-label lookup: `agents` → "Agents", `skills` → "Skills", `mcp-servers` → "MCP Servers"
    - Returns `null` on `/library` (landing page), renders "Library / Agents" etc. on sub-pages
    - Supports arbitrary depth for future nested routes
  - Updated `client-apps/web/src/app/library/layout.tsx` — renders `<LibraryBreadcrumb />` above children, added `"use client"` directive
  - Added "Create New" shortcuts to `LibraryLanding.tsx`
    - Three ghost-style links below the cards grid: "Create Agent", "Create Skill", "Create MCP Server"
    - Data-driven via `CREATE_SHORTCUTS` constant, `Plus` icon from lucide-react
    - All navigate to `/` (home/SessionLauncher) for Phase 1 — Phase 3 (T03.3) will add query-param pre-fill
    - Uses Next.js `<Link>` for proper SPA navigation
    - Visually secondary to cards: `text-muted-foreground`, smaller text, ghost hover state

### Decision
- **"Create New" shortcuts navigate to `/` for Phase 1**: Pre-fill infrastructure (auto-selecting system agent) is Phase 3 scope. Adding non-functional buttons or buttons that navigate to non-existent list pages would be confusing UX. Navigating to the generic SessionLauncher is honest — user can start a session and manually pick the right system agent.

### Verification
- TypeScript check passes (zero errors in new/modified files)
- Lint clean on all 4 files (1 new, 3 modified)

## Next Steps

1. **T01.11 — Agent list page**: `/library/agents`
2. **T01.12 — Skill list page**: `/library/skills`
3. **T01.13 — MCP Server list page**: `/library/mcp-servers`

## Context for Resume

- **Data layer complete** (T01.1–T01.4): list hooks + count hooks, all scope-aware
- **UI components complete** (T01.5–T01.7): `ScopeToggle`, `ResourceListView`, `ResourceCountCard` in `library/` module
- **Sidebar link complete** (T01.9): "Library" link in sidebar with active state for `/library/*`
- **Landing page complete** (T01.10): `/library` shows three `ResourceCountCard` cards with live counts, breadcrumb nav, and "Create New" shortcuts
- **T01.8 skipped**: barrel exports already done for all three components
- The `library/` module has 3 components + 4 type exports: `ScopeToggle`, `ResourceListView`, `ResourceCountCard`, `ScopeToggleProps`, `ResourceListViewProps`, `ResourceCountCardProps`, `ResourceListScope`
- Count hooks return `count: number | undefined` — `undefined` = not yet loaded, `0` = loaded with zero results
- Breadcrumb component in layout — sub-pages (T01.11–T01.13) get breadcrumbs automatically
- "Create New" shortcuts all go to `/` for now — Phase 3 adds pre-fill via query params
- **Next work is Console list pages** (T01.11–T01.13) — each page composes `ResourceListView` with the corresponding list hook
- Branch: `feat/add-customize-ui-2`
- Card links go to `/library/agents`, `/library/skills`, `/library/mcp-servers` — will 404 until T01.11–T01.13 are implemented

## Quick Commands

After loading context:
- "Continue with T01.11" — Implement Agent list page
- "Continue with T01.12" — Implement Skill list page
- "Continue with T01.13" — Implement MCP Server list page
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
