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
**Current Task**: T02 — Phase 2: Execution Artifacts Widget + Apply Flow
**Status**: In Progress (T02.1–T02.3 complete, T02.4–T02.8 remaining)

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

## Session Progress (2026-03-20, Session 10)

### Completed
- **T01.11 — Agent list page**: Created `/library/agents` route in the Console
  - `client-apps/web/src/app/library/agents/page.tsx` — thin server component entry point
  - `client-apps/web/src/app/library/agents/AgentListPage.tsx` — client component composing `useAgentList` + `ResourceListView`
  - Manages three pieces of local state: `scope` (persisted to localStorage), `query`, `page`
  - Scope persisted to localStorage per DD-003 key `stigmer:library:agents:scope`, defensive read (validates stored value, SSR-safe)
  - Page header: "Agents" h1 + "Create Agent" ghost link (navigates to `/` for Phase 1)
  - Agent-specific customizations: `searchPlaceholder="Search agents…"`, `emptyIcon=<Bot>`, `emptyTitle="No agents found"`, `aria-label="Agent list"`
  - No custom row renderer — `DefaultResourceRow` in `ResourceListView` handles rendering with correct `AgentIcon` via `KindIcon`
  - No `onItemClick` — rows are informational for Phase 1 (detail pages are Phase 5)
  - Breadcrumb "Library / Agents" handled automatically by `LibraryBreadcrumb` in layout

### Architecture Decision
- **Console composition over SDK wrapper**: Chose to compose `useAgentList` + `ResourceListView` at the Console level rather than building an `AgentListView` SDK component. The building blocks are already in the SDK; a pre-composed wrapper would be speculative without platform builder usage evidence. Extraction is trivially easy later.

### Verification
- TypeScript check passes (zero errors in new files)
- Lint clean on both files
- Landing page card link to `/library/agents` now resolves

## Session Progress (2026-03-20, Session 11)

### Completed
- **T01.12 — Skill list page**: Created `/library/skills` route in the Console
  - `client-apps/web/src/app/library/skills/page.tsx` — thin server component entry point
  - `client-apps/web/src/app/library/skills/SkillListPage.tsx` — client component composing `useSkillList` + `ResourceListView`
  - Same pattern as T01.11: three pieces of local state (`scope`, `query`, `page`), scope persisted to localStorage
  - Scope persistence key: `stigmer:library:skills:scope`
  - Page header: "Skills" h1 + "Create Skill" ghost link (navigates to `/` for Phase 1)
  - Skill-specific customizations: `searchPlaceholder="Search skills…"`, `emptyIcon=<Sparkles>`, `emptyTitle="No skills found"`, `aria-label="Skill list"`
  - Default row renderer — no custom `renderItem` (same Phase 1 trade-off as T01.11)
  - Breadcrumb "Library / Skills" handled automatically by `LibraryBreadcrumb` in layout
  - Committed: `0403fe3c feat(web): add Skill list page at /library/skills`

### Verification
- TypeScript check passes (zero errors in new files)
- Lint clean on both files
- Landing page card link to `/library/skills` now resolves

## Session Progress (2026-03-20, Session 12)

### Completed
- **T01.13 — MCP Server list page**: Created `/library/mcp-servers` route in the Console
  - `client-apps/web/src/app/library/mcp-servers/page.tsx` — thin server component entry point
  - `client-apps/web/src/app/library/mcp-servers/McpServerListPage.tsx` — client component composing `useMcpServerList` + `ResourceListView`
  - Same pattern as T01.11/T01.12: three pieces of local state (`scope`, `query`, `page`), scope persisted to localStorage
  - Scope persistence key: `stigmer:library:mcp-servers:scope`
  - Page header: "MCP Servers" h1 + "Create MCP Server" ghost link (navigates to `/` for Phase 1)
  - MCP Server-specific customizations: `searchPlaceholder="Search MCP servers…"`, `emptyIcon=<Server>`, `emptyTitle="No MCP servers found"`, `aria-label="MCP server list"`
  - Breadcrumb "Library / MCP Servers" handled automatically by `LibraryBreadcrumb` in layout (`mcp-servers` segment already mapped)

### Verification
- TypeScript check passes (zero errors in new files)
- Lint clean on both files
- Landing page card link to `/library/mcp-servers` now resolves

### Phase 1 Complete
- All tasks T01.1–T01.13 are done
- 3 SDK data hooks (`useAgentList`, `useSkillList`, `useMcpServerList`)
- 3 SDK count hooks (`useAgentCount`, `useSkillCount`, `useMcpServerCount`)
- 3 SDK UI components (`ScopeToggle`, `ResourceListView`, `ResourceCountCard`)
- 1 sidebar link with active state
- 1 landing page with count cards + breadcrumbs + create shortcuts
- 3 resource list pages with search, scope toggle, pagination

## Session Progress (2026-03-20, Session 13)

### Completed
- **T02.1 — Execution Artifact Data Hooks**: Full implementation complete
  - **Architecture decision**: Content fetching goes through a new `getArtifactContent` backend RPC (not direct R2 fetch), eliminating CORS concerns for SDK consumers
  - **Architecture decision**: Decomposed original "God hook" into layered, single-purpose hooks following headless-first pattern
  - **Proto changes** (`io.proto`, `query.proto`): Added `GetArtifactContentRequest` / `GetArtifactContentResponse` messages and `getArtifactContent` RPC to `AgentExecutionQueryController` with full documentation
  - **Generated stubs updated**: `io_pb.ts`, `query_pb.ts`, `query_connect.ts`, `agentexecution.ts` — manually scaffolded to add new types/methods (will be properly regenerated by buf generate + stigmer-codegen)
  - **`useExecutionArtifacts` hook**: Pure `useMemo` derivation (like `useExecutionUsage`). Extracts `execution.status?.artifacts`. Returns `{ artifacts, hasArtifacts, artifactCount }`
  - **`artifact-utils.ts`**: Four pure functions — `isTextArtifact` (extension heuristic), `isArtifactExpired` (checks expiresAt), `formatArtifactSize` (handles bigint from int64), `getArtifactExtension`
  - **`useArtifactContent` hook**: Data-fetching hook for single artifact. Calls `getArtifactContent` RPC. Pass null to skip. Returns `{ content, contentType, isTruncated, isLoading, error, refetch }`
  - **Barrel exports**: Both `execution/index.ts` and `sdk/react/src/index.ts` updated. Proto types `ExecutionArtifact` and `ExecutionArtifactKind` re-exported for consumer convenience
  - TypeScript check clean (zero new errors), lint clean on all files

### Key Architecture Decisions
- **Backend proxy for content reading**: Pre-signed URLs are for download (browser navigation). Content reading (YAML detection, preview) goes through the Stigmer API to avoid CORS dependency for platform builders.
- **Three-layer hook decomposition**: `useExecutionArtifacts` (derivation) → `useArtifactContent` (fetch) → `useDetectStigmerResource` (detection, T02.2). Each independently useful for platform builders.
- **No size guard in the hook**: Server enforces `max_bytes`. The caller decides whether to invoke based on `isTextArtifact()` and size — hook doesn't silently skip.

### Dependencies
- ~~**Server implementation needed**: `getArtifactContent` handler~~ — **DONE in Session 14** (Go handler in stigmer OSS, Java handler in stigmer-cloud)
- ~~**Proto regeneration needed**: Run `buf generate` + `stigmer-codegen`~~ — **DONE** (all language stubs regenerated)

## Session Progress (2026-03-20, Session 14)

### Completed
- **`getArtifactContent` backend handler (Go, stigmer OSS)**: Implemented `GetArtifactContent` on `AgentExecutionController`
  - Validates `execution_id`, `storage_key` (non-empty, prefix check for path traversal prevention)
  - Downloads via `c.artifactStorage.Download()` (works with both `LocalStorage` and `R2Storage`)
  - Enforces `max_bytes` truncation (default 512 KB), detects content type by extension (17-entry map + `mime.TypeByExtension()` fallback)
  - New file: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/get_artifact_content.go`

- **`getArtifactContent` backend handler (Java, stigmer-cloud)**: Implemented pipeline handler + R2 range-read method
  - Added `get(String key, long maxBytes)` to `AgentExecutionArtifactR2Store` — S3 `HEAD` + `Range`-limited `GET` for memory-safe reads
  - Created `AgentExecutionGetArtifactContentHandler` with pipeline: validate → authorize → validate prefix → load content → send response
  - `ValidateStorageKeyPrefixStep` duplicated as inner class (Java generics prevent sharing across handler types)
  - `LoadArtifactContentStep` with identical 17-entry content type map kept in sync with Go

- **Proto stubs regenerated**: All language stubs (Go, Java, Python, TypeScript, Dart) regenerated in both repos

### Commits
- stigmer OSS: `587e6fb3 feat(backend): implement getArtifactContent handler and regenerate stubs`
- stigmer-cloud: `0f4e88d7 feat(backend): implement getArtifactContent handler with R2 range reads`

## Session Progress (2026-03-20, Session 15)

### Completed
- **T02.2 — `useDetectStigmerResource` behavior hook**: Fully implemented and exported
  - Created `sdk/react/src/library/detect-stigmer-resource.ts` — pure `detectStigmerResource(content)` function
    - Parses YAML using the `yaml` npm package (new dependency, ~50KB gzipped)
    - Validates `apiVersion` against `*.stigmer.ai/*` pattern (regex: `/^[a-z]+\.stigmer\.ai\/v\d+$/`)
    - Checks `kind` against known set: `Agent`, `McpServer`, `Skill`
    - Verifies `metadata` is an object with a non-empty `name` string
    - Extracts `metadata.org` when present
    - Returns discriminated union: `{ detected: false }` or `{ detected: true, apiVersion, kind, displayName, resourceName, resourceOrg }`
    - Resilient by design — never throws, any failure returns `{ detected: false }`
    - Includes `displayName` mapping (e.g., `McpServer` → `"MCP Server"`) so UI layer doesn't need its own map
  - Created `sdk/react/src/library/useDetectStigmerResource.ts` — thin `useMemo` hook wrapper
    - Accepts `string | null` — safe to call while `useArtifactContent` is still loading
    - Memoized — detection only re-runs when `content` changes by reference
  - Updated barrel exports in `library/index.ts` and `sdk/react/src/index.ts`
  - TypeScript check clean, zero lint errors
  - Committed: `1aa998b8 feat(sdk/react): add Stigmer resource detection for execution artifacts`

### Architecture Decision
- **Pure function + hook wrapper**: Core detection logic is a pure function (`detectStigmerResource`) independently testable and usable outside React. The hook (`useDetectStigmerResource`) is a thin `useMemo` wrapper. This matches the `aggregateUsage` / `useExecutionUsage` pattern and the headless-first SDK architecture.
- **Lean return type**: The full parsed YAML is NOT returned — the apply hook (T02.3) will re-parse from the raw content string. Parsing is cheap (~1ms) and keeping the return type lean avoids exposing an untyped `Record<string, unknown>` in the public API.
- **Only 3 kinds for now**: Agent, McpServer, Skill. Adding Workflow/Environment later is trivial (add to `KIND_DISPLAY_NAMES` map + `StigmerResourceKind` union).
- **Directory artifact detection deferred**: ZIP inspection for skill packages is not in scope — only text file artifacts are handled.

## Session Progress (2026-03-20, Session 16)

### Completed
- **Directory Artifact Support (D1–D8)**: Full vertical implementation enabling directory artifact detection, content preview, and server-side skill push

#### Proto Layer (D1)
- Added `repeated string entries = 9` to `ExecutionArtifact` — self-describing directory artifacts
- Added `string entry_path = 4` to `GetArtifactContentRequest` — ZIP entry extraction
- Added `PushSkillFromExecutionArtifactRequest` + `pushFromExecutionArtifact` RPC on `SkillCommandController`
- Regenerated all language stubs (Go, Java, Python, TypeScript) and SDK clients
- Updated `tools/codegen/schemas/services/skill.json` for SDK client generation

#### Agent Runner (D2)
- Updated `publish_artifact.py` to populate `entries` from ZIP listing (sandbox: `zipinfo -1`, local: `Path.rglob()`)

#### Backend — Go + Java (D3–D4)
- Go: `getArtifactContent` ZIP entry extraction + `extractZipEntry()` helper
- Go: `push_from_execution_artifact.go` — downloads from execution storage, delegates to `Push()` pipeline
- Go: Added `executionArtifactStorage` to `SkillController`, wired in `server.go`
- Java: `LoadArtifactContentStep` ZIP entry extraction via `ZipInputStream`
- Java: `SkillPushFromExecutionArtifactHandler` — full pipeline handler (11 steps)

#### SDK Detection (D5–D6)
- `detect-skill-package.ts`: `isSkillPackage()` (sync entries check), `detectSkillPackage()` (frontmatter parsing)
- `useDetectSkillPackage` hook: combines entries check with lazy SKILL.md fetch via `entry_path`
- `useArtifactContent` extended with optional `entryPath` parameter

#### Cleanup (D8)
- Removed `"Skill"` from `StigmerResourceKind` — skills use package detection path, not YAML detection

### Architecture Decisions
- **Self-describing artifacts**: `entries` field on `ExecutionArtifact` eliminates detection RPCs
- **Server-side skill push**: `pushFromExecutionArtifact` avoids CORS/bandwidth/size issues
- **Two parallel detection paths**: YAML detection (Agent, McpServer) vs package detection (Skill)

### Blocked
- **D7**: Skill push integration into `useApplyResource` — blocked on T02.3 (hook doesn't exist yet). Will be incorporated when T02.3 is built.

### Files Changed (stigmer OSS)
- 50 files changed, ~2050 insertions, ~240 deletions
- 6 new files (Java proto stubs, Go handler, SDK detection modules)

### Files Changed (stigmer-cloud)
- 2 files changed (1 new handler, 1 modified handler)

## Session Progress (2026-03-20, Session 17)

### Completed
- **T02.3 — `useApplyResource` behavior hook**: Full implementation complete
  - Created `sdk/react/src/library/parse-resource-yaml.ts` — pure `parseResourceYaml(content, org)` function
    - Explicit per-field converters for Agent and McpServer YAML → SDK input types
    - Handles all nested structures: `mcp_server_usages`, `sub_agents`, `env_spec`, `stdio`/`http`, resource refs, tool approval overrides
    - Proto `env_spec.data` → SDK `envSpec.variables` naming mismatch handled explicitly
    - Accepts both snake_case (proto) and camelCase (SDK) field names in YAML
    - Descriptive, user-facing error messages for all validation failures
    - McpServer `tags` field intentionally dropped (not in `McpServerInput`)
    - `org` parameter always overrides `metadata.org` (matches "Apply to [my-org]" UX)
  - Created `sdk/react/src/library/useApplyResource.ts` — behavior hook
    - Two action methods: `applyYamlResource(content, org)` and `pushSkillPackage(params)`
    - Follows established mutation pattern: `isApplying`, `error`, `clearError` (same as `useCreateOrganization`)
    - No stored result — promise returns `ApplyResourceResult`, consistent with all SDK mutation hooks
    - Returns `{ kind, name, org, slug }` from response metadata for Library linking
    - Incorporates deferred D7 (skill push via `pushFromExecutionArtifact` RPC)
  - Updated barrel exports: `library/index.ts` and `sdk/react/src/index.ts`
  - Also elevated skill detection exports (`isSkillPackage`, `detectSkillPackage`, `useDetectSkillPackage`, `SkillPackageDetection`, `UseDetectSkillPackageReturn`) to top-level barrel — previously only in `library/index.ts`

### Key Design Decisions (from this session)
- **Explicit per-field converters over generic snake-to-camel**: Map fields (labels, env vars, headers) preserve their keys. The `env_spec.data` → `envSpec.variables` rename is handled naturally. Type-safe at compile time.
- **Conditional spread pattern**: Used `...optionalField("key", value)` throughout to construct typed objects with optional fields without mutation — avoids TypeScript index signature issues with readonly interfaces.

### Verification
- TypeScript check passes (8 pre-existing errors in unrelated test file, zero in new/modified files)
- Lint clean on all 4 files (2 new, 2 modified)
- All existing exports unchanged — no breaking changes

## Next Steps

1. **T02.4 — `ArtifactCard` component**: Single artifact in the widget — must render both file and directory artifacts with skill detection badges
2. **T02.5 — `ArtifactPreviewModal` component**: Full YAML preview with Apply CTA — must show file listings for directories
3. **T02.6 — `ArtifactsWidget` component**: Right-sidebar container for artifact cards — must handle both artifact kinds
4. **T02.7 — Barrel exports** for artifact components
5. **T02.8 — SessionPage integration**: Wire `ArtifactsWidget` into right sidebar

## Context for Resume

- **Phase 1 (Library Pages + Navigation) is COMPLETE** — all tasks T01.1–T01.13 done
- **Phase 2 (Execution Artifacts Widget + Apply Flow) is IN PROGRESS** — T02.1–T02.3 complete, directory artifact support (D1–D8) complete, T02.4–T02.8 remaining
- **Directory artifact support COMPLETE** — full vertical implementation from proto to SDK:
  - Proto: `entries` on `ExecutionArtifact`, `entry_path` on `GetArtifactContentRequest`, `pushFromExecutionArtifact` RPC
  - Agent runner: populates `entries` when creating ZIP from directory
  - Backend (Go + Java): ZIP entry extraction, server-side skill push
  - SDK: `isSkillPackage()`, `detectSkillPackage()`, `useDetectSkillPackage()`, `useArtifactContent` with `entryPath`
  - Cleanup: removed `"Skill"` from `StigmerResourceKind` (skills use package detection, not YAML detection)
  - **D7 complete**: skill push integration built into `useApplyResource` (T02.3)
- **Two parallel detection paths**:
  - YAML detection: `detectStigmerResource(content)` → `Agent` | `McpServer` → `apply()`
  - Package detection: `isSkillPackage(artifact)` / `detectSkillPackage(artifact, content)` → Skill → `pushFromExecutionArtifact()`
- **Backend handlers DONE**: `getArtifactContent` (with `entry_path` support) and `pushFromExecutionArtifact` implemented in both Go (stigmer OSS) and Java (stigmer-cloud)
- **T02.1 deliverables**: 2 hooks (`useExecutionArtifacts`, `useArtifactContent`), 4 utility functions, proto definition for `getArtifactContent` RPC
- **T02.2 deliverables**: 1 pure function (`detectStigmerResource`), 1 hook (`useDetectStigmerResource`), 2 types (`StigmerResourceDetection`, `StigmerResourceKind`)
- **Directory artifact deliverables**: 2 pure functions (`isSkillPackage`, `detectSkillPackage`), 1 hook (`useDetectSkillPackage`), 1 type (`SkillPackageDetection`), `useArtifactContent` extended with `entryPath`
- **T02.3 deliverables**: 1 pure function (`parseResourceYaml`), 1 hook (`useApplyResource`), 3 types (`ParsedResource`, `ApplyResourceResult`, `PushSkillParams`)
- **Apply flow (YAML resources)**: `useArtifactContent` → content → `useDetectStigmerResource` → detection → `useApplyResource().applyYamlResource(content, org)` → `parseResourceYaml` → `stigmer.agent.apply()` or `stigmer.mcpServer.apply()`
- **Apply flow (skill packages)**: `useDetectSkillPackage` → detection → `useApplyResource().pushSkillPackage({ org, executionId, storageKey })` → `stigmer.skill.pushFromExecutionArtifact()`
- **YAML → SDK input conversion**: `parseResourceYaml` handles proto snake_case → SDK camelCase for Agent (`mcpServerUsages`, `subAgents`, `envSpec`) and McpServer (`stdio`, `http`, `defaultToolApprovals`). Proto `env_spec.data` maps to SDK `envSpec.variables`. `org` parameter always overrides `metadata.org`.
- **New dependency**: `yaml` ^2.8.2 added to `@stigmer/react` for YAML/frontmatter parsing in detection
- **Detection flow (file artifacts)**: `useArtifactContent` → content string → `useDetectStigmerResource` → `StigmerResourceDetection`
- **Detection flow (directory artifacts)**: `useDetectSkillPackage(artifact, executionId)` → fetches SKILL.md via `entry_path` → `SkillPackageDetection`
- **Supported YAML kinds**: `Agent`, `McpServer` — validated against `apiVersion: *.stigmer.ai/*` pattern
- **Artifact types from protos**: `ExecutionArtifact` (artifact_pb) with `entries` field, `ExecutionArtifactKind` enum (FILE, DIRECTORY) from enum_pb
- **Field name mapping**: proto `size_bytes` → TS `sizeBytes: bigint`, proto `storage_key` → TS `storageKey`, proto `download_url` → TS `downloadUrl`, proto `expires_at` → TS `expiresAt`
- **Existing right sidebar**: `SessionPage` renders `ExecutionProgress` and `ExecutionCostSummary` in the aside — `ArtifactsWidget` (T02.6) will be added below these
- **Error pattern**: `useArtifactContent` uses `error: string | null` (matches `useResourceList` pattern, not `Error | null`)
- **Branch**: `feat/add-customize-ui-2` (stigmer OSS), `feat/add-library-ui` (stigmer-cloud)
- **Plan reference**: `/Users/suresh/.cursor/plans/directory_artifact_support_c403095b.plan.md`

## Quick Commands

After loading context:
- "Continue Phase 2 with T02.4" — Build ArtifactCard component
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
