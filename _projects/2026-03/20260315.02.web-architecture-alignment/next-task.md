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
- **Last Session**: 2026-03-15 — Phase 7 (Domain UI Components + List/Detail View Enhancement) completed
- **Active Task**: None — Phase 7 complete
- **Next Task**: Phase 8 — Workflow & IAM views (deferrable), or Phase 9 — Final polish & verification

## Session Progress (2026-03-15, Session 10)

### Phase 7 (Revised): Domain UI Components + List/Detail View Enhancement — COMPLETED

Revised Phase 7 scope: enriched `@stigmer/agent-ui` with embeddable card and overview components, replaced generic resource cards with domain-aware rendering, improved all three detail views, deleted all deprecated code.

**Part A: `@stigmer/agent-ui` domain components** (6 new files):
- Internal primitives: `badge.tsx`, `collapsible.tsx`, `section.tsx` (following `agent-execution-ui` pattern)
- `AgentCard.tsx` — Embeddable card accepting `Agent` proto, renders icon/name/slug/description/stats/badges/tags. Framework-agnostic (`onClick`/`href` props, no `next/link`)
- `AgentOverview.tsx` — Embeddable read-only overview extracted from `AgentDetailView`. Renders header, collapsible instructions, MCP server usages with tool badges, skill refs, sub-agents
- `styles.css` — Tailwind v4 + `@stigmer/theme/tokens.css`
- `package.json` updated: `./styles.css` export, peer deps (`@base-ui/react`, `class-variance-authority`, `lucide-react`)

**Part B: Console list view enhancement** (5 new files):
- `AgentSearchCard` — Card-style layout for grid, renders `SearchResult` with icon/name/description/tags/timestamp
- `SkillSearchCard` — List-item layout with tag badge and description
- `McpServerSearchCard` — List-item layout with tags and timestamp
- `ResourceList` — Render-prop component with `layout` prop ("list" | "grid"), search/pagination/loading/empty states
- `ResourceEmptyState` — Domain-aware empty state (replaces `CatalogEmptyState`)
- Agents page switched to responsive card grid (1/2/3 columns). Skills and MCP Servers keep list layout.

**Part C: Console detail view improvements** (3 modified files):
- `AgentDetailPage` — Thin shell: TopBar + `AgentOverview` (from domain library) + Run Agent button + SessionHistory. Deleted `AgentDetailView.tsx`.
- `SkillDetailView` — Added `SkillState` badges (Ready/Uploading/Failed), git provenance section, markdown rendering for SKILL.md
- `McpServerDetailView` — Added stats row (tool count, template count, discovery metadata), environment variables section

**Part D: Cleanup** (4 deleted, 1 migrated):
- Migrated `OrgProvider` to `useStigmerTransport()` (last consumer of singleton transport)
- Deleted `services/transport.ts`, `services/org-service.ts`, `components/agent/AgentDetailView.tsx`
- Deleted `components/catalog/` directory (4 files: ResourceCard, ResourceList, CatalogEmptyState, index)

**Key Decisions**:
- Agent gets full domain library treatment; Skill/MCP Server stay Console-only (deferred to marketplace work)
- Separate card types for different data contexts: domain card (full proto) vs Console search card (SearchResult)
- Card grid for agents (browse/discover pattern), list for skills/MCP servers (operational pattern)
- Internal primitives duplicated between `agent-ui` and `agent-execution-ui` (small surface area, avoids coupling)

**Verification**: `tsc --noEmit` clean (exit code 0), no lint errors.

## Session Progress (2026-03-15, Session 9)

### T13: Dashboard Improvements — COMPLETED

Transformed dashboard from a quick-actions page to an organizational overview with resource counts, trimmed quick actions, and enhanced RecentSessions.

**New Files** (4 files):
- `hooks/dashboard/keys.ts` — Dashboard query key factory (`dashboardKeys.all`, `dashboardKeys.counts(org)`)
- `hooks/dashboard/useDashboardCounts.ts` — Layer 3 hook: 3 parallel search queries for agent/skill/MCP server counts via existing domain service hooks. Returns per-resource `count`, `isLoading`, `error`.
- `components/dashboard/ResourceOverview.tsx` — Stat card grid (3 columns). Each card: icon + label + count (or skeleton/dash), links to resource list page.
- `components/dashboard/QuickActions.tsx` — Extracted from `page.tsx`, trimmed to Run Agent + Draft Resource (2-column grid).

**Modified Files** (3 files):
- `components/dashboard/RecentSessions.tsx` — Replaced inline error div with `<ErrorMessage>` component. Improved empty state with onboarding hint and Run Agent link.
- `hooks/sessions/useSessionList.ts` — `error` return type changed from `string | null` to `Error | null` (needed by `ErrorMessage`, consistent with `useSessionPage`).
- `app/page.tsx` — Composes ResourceOverview + QuickActions + RecentSessions. TopBar description updated. All inline QUICK_ACTIONS code removed.

**Architecture Decisions**:
- Resource counts via domain search services with `page: { num: 1, size: 1 }` + `select` for `totalCount` — minimal payload, independent failure isolation.
- 3 parallel `useQuery` calls (not single multi-kind request) — respects three-layer architecture, uses Layer 2 service hooks directly.
- Dashboard query keys isolated from domain keys — stale time + `refetchOnWindowFocus` for cache invalidation.
- Browse Agents removed from quick actions — triple-redundant with sidebar nav + stat card link.

**Server API Gap**: No aggregate execution endpoints (`CountExecutionsByPhase`, `ListActiveExecutions`, `ListRecentFailedExecutions`, `ListPendingApprovals`). Execution status widgets deferred to server API work.

**Verification**: `next build` clean, `eslint --max-warnings 0` clean, `prettier --check` clean on all modified/new files.

## Session Progress (2026-03-15, Session 8)

### T12: Sessions Page — COMPLETED

Sessions list page: data table, agent filter, pagination, and proper empty/loading/error states.

**New Files** (3 files):
- `components/ui/table.tsx` — Reusable table primitives (Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption). Styled atoms, no logic.
- `hooks/sessions/useSessionPage.ts` — Page-based session query hook (`useQuery`, not `useInfiniteQuery`). Supports `agentId` filter to switch between `list()` and `listByAgent()`.
- `app/sessions/page.tsx` (replaced empty `<div />`) — Full sessions page with TopBar, agent filter dropdown, data table, pagination, loading/error/empty states.

**Modified Files** (1 file):
- `hooks/sessions/keys.ts` — Added `pages()` and `page()` key factories for page-based queries.

**Architecture Decisions**:
- Table components are Console-only — `@stigmer/session-ui` keeps its current shape (Layer 1 service factory + Layer 2 hook). Embeddable session components (replay viewer) are a separate future task.
- Scoped to current API surface — the `SessionQueryController` supports `list(pageSize, pageToken, tags[])` and `listByAgent(agentId, pageSize, pageToken)`. No server-side text search, sorting, date range, or status filter.
- No status column — Session has no lifecycle status field (it's derived from the latest AgentExecution). Deferred until the server adds a denormalized status field.
- `useSessionPage` uses `useQuery` (not `useInfiniteQuery`) for table-style page navigation. `useSessionList` (infinite) remains untouched for `RecentSessions` and `AgentSessionHistory`.

**Server API Gaps Identified**:
- `ListSessionsRequest` needs: `sort_by`, `sort_order`, `search_text`, `created_after`/`created_before`
- Session response needs denormalized `agent_display_name` or `agent_slug` (avoid N+1 agent resolution)
- Session needs a derived `lifecycle_status` field (from latest AgentExecution)
- These gaps block: text search, column sorting, date range filtering, status filtering, agent name display in table

**Verification**: `next build` clean, `eslint --max-warnings 0` clean, `prettier --check` clean.

## Session Progress (2026-03-15, Session 7)

### T11: Global Header, Sidebar Polish, Breadcrumbs — COMPLETED

Phase 6 layout overhaul: full-width global header, collapsible sidebar, and reusable breadcrumb system.

**New Components** (5 files):
- `AppHeader.tsx` — Full-width fixed header bar (z-40). Logo + OrgSwitcher + spacer + ThemeToggle + UserMenu
- `UserMenu.tsx` — Disabled auth: static User icon; OIDC: avatar dropdown with email and sign-out
- `Breadcrumb.tsx` — Hierarchical nav trail with ChevronRight separators and `aria-current="page"`
- `useSidebarCollapse.ts` — `useSyncExternalStore`-based hook for localStorage-persisted collapse state (SSR-safe)
- `dropdown-menu.tsx` — shadcn dropdown-menu via `@base-ui/react/menu`

**Modified Components** (4 files):
- `AppShell.tsx` — Header + sidebar + main with dynamic offsets and collapse transition
- `Sidebar.tsx` — Logo/OrgSwitcher/ThemeToggle removed (moved to header), collapse toggle added
- `TopBar.tsx` — Optional `breadcrumbs` prop renders `Breadcrumb` above title
- `OrgSwitcher.tsx` — Styling adapted for header context

**Detail Pages Updated** (4 files):
- `AgentDetailPage`, `SkillDetailPage`, `McpServerDetailPage` — ArrowLeft replaced with TopBar breadcrumbs
- `SessionDetailPage` — ArrowLeft replaced with inline Breadcrumb (custom chat-specific layout)

**Key Decisions**:
- Header-above-sidebar layout (Planton/Linear pattern)
- Deferred Cmd+K and notifications to separate future tasks
- `useSyncExternalStore` over `useState`+`useEffect` for localStorage (same ESLint rule as ThemeToggle in Session 2)

**Verification**: `next build` clean, `eslint --max-warnings 0` clean, `prettier --check` clean.

## Session Progress (2026-03-15, Session 6)

### T09: Error Handling Framework — COMPLETED

**Scope expanded** (user decision): T09 was originally scoped to "error interceptors only." Expanded to include display infrastructure (toast library, inline error components, TanStack Query retry config) — interceptors without display infrastructure are incomplete.

**UX decision** (user decision): Non-blocking toast for server errors instead of global error modal (Planton pattern rejected).

**Tier 1 — `@stigmer/rpc-client` (infrastructure library)**:
- `errors.ts` (NEW): Error classification — `ErrorCategory` type (8 categories mapping all gRPC codes), `classifyError()`, `getUserMessage()` (sanitizes infrastructure noise), `isRetryableError()`, `isConnectError()` type guard, `annotateRpcError()`/`getRpcMetadata()` (WeakMap-backed RPC metadata)
- `interceptors.ts`: Added `rpcMetadataInterceptor` (annotates errors with method name/path) and `createAuthRedirectInterceptor()` (calls `onUnauthenticated` once on code 16)
- `types.ts`: Added `onUnauthenticated?: () => void` to `StigmerRpcConfig` (backward-compatible)
- `transport.ts`: Updated interceptor chain: auth → metadata → strip → auth-redirect → custom

**Tier 2 — Console infrastructure**:
- Installed `sonner` (~3KB toast library)
- `sonner.tsx` (NEW): Themed Toaster wrapping sonner with next-themes sync and shadcn design tokens
- `Providers.tsx`: Smart retry via `isRetryableError` (only server/unavailable retry once), mutations never retry, `<Toaster />` added

**Tier 3 — Display components**:
- `error-message.tsx` (NEW): Inline error display with classified messages, expandable RPC metadata, conditional retry button
- `error.tsx`: Root error boundary improved — category-specific titles, error digest display
- `StigmerTransportBridge.tsx`: Wired `onUnauthenticated` via `logout()`
- `AgentDetailPage.tsx` and `SkillDetailPage.tsx`: Updated to use `<ErrorMessage error={error} retry={refetch} />`

**Coding guideline updated**: `query-command-hooks.md` — Error Handling section expanded with three-tier architecture, classification table, mutation toast pattern, smart retry docs, `ErrorMessage` usage

**Verification**: `tsc --noEmit` (rpc-client), `next build`, `eslint --max-warnings 0` — all clean.

## Session Progress (2026-03-15, Session 5)

### T07+T08: Refactor Hooks to Query/Command Pattern + Service Reorganization — COMPLETED

**Tasks merged**: T07 (hook refactor) and T08 (service reorganization) were implemented together because Layer 3 hooks depend on Layer 1 factories and Layer 2 service hooks — implementing them separately would have required throwaway intermediate code.

**Foundation**:
- Installed `@tanstack/react-query`, added `QueryClientProvider` to `Providers.tsx` (staleTime: 30s, retry: 1, refetchOnWindowFocus: true)
- Created `useDebouncedValue` utility hook for search inputs

**Domain Libraries Created** (Layer 1 + Layer 2):
- `@stigmer/agent-ui` — `AgentQueryService` factory (get, getByReference, search), `useAgentQueryService` hook
- `@stigmer/session-ui` — `SessionQueryService` factory (get, list, listByAgent), `useSessionQueryService` hook
- `@stigmer/skill-ui` — `SkillQueryService` factory (get, search), `useSkillQueryService` hook
- `@stigmer/mcp-server-ui` — `McpServerQueryService` factory (get, search), `useMcpServerQueryService` hook

**Console Query Hooks Created** (Layer 3):
- Agents: `useAgent`, `useAgentList`, `useAgentSearch`, `useDraftAgent` (with query key factory)
- Sessions: `useSession`, `useSessionExecutions`, `useSessionList`, `useAgentSessionList` (with query key factory)
- Skills: `useSkill`, `useSkillList` (with query key factory)
- MCP Servers: `useMcpServer`, `useMcpServerList` (with query key factory)

**Consumer Components Updated** (11 files):
- `AgentDetailPage`, `agents/page`, `AgentPicker`, `DraftPage`
- `SessionDetailPage`, `RecentSessions`, `AgentSessionHistory`
- `SkillDetailPage`, `skills/page`
- `McpServerDetailPage`, `mcp-servers/page`
- `ResourceList` (decoupled from old `useResourceCatalog` type)

**Old Code Deleted** (14 files):
- Hooks: `useAgentDetail`, `useAgentSearch` (old), `useDraftAgent` (old), `useResourceCatalog`, `useSessionDetail`, `useSessions`, `useAgentSessions`, `useSkillDetail`, `useMcpServerDetail`
- Services: `agent-service`, `search-service`, `session-service`, `skill-service`, `mcp-server-service`
- Deprecated with comments: `transport.ts` (singleton), `org-service.ts` (legacy transport)

**Surprise Encountered**:
- `useResourceCatalog` was used by `/skills` and `/mcp-servers` pages in addition to `/agents`. Addressed by consistently applying the pattern: added `search` methods to `SkillQueryService` and `McpServerQueryService`, created `useSkillList` and `useMcpServerList` hooks.

**Key Design Decisions**:
- `useSessionDetail` split into `useSession` + `useSessionExecutions` (single responsibility)
- `useInfiniteQuery` for cursor-based session pagination ("load more"), `useQuery` for page-based resource lists
- `fetchNextPage`/`refetch` wrapped in `useCallback` to match `onClick` signatures
- `OrgProvider` kept as-is — its local storage + active selection concerns don't align with TanStack Query

**Verification**: `npm run build` clean, `eslint --max-warnings 0` clean, `tsc --noEmit` clean for all 4 domain libraries.

### Flatten `@stigmer/agent-execution-ui` package structure — COMPLETED

The pre-existing `agent-execution-ui` package had unnecessary nesting that was inconsistent with the 4 new domain packages:
- `src/execution/` subdirectory removed — contents moved to `src/` (the package IS execution, the word appeared twice in imports)
- `src/internal/ui/` flattened to `src/internal/` (only subdirectory, redundant level)
- `./execution` subpath export removed from `package.json`
- 4 consumer files updated: `@stigmer/agent-execution-ui/execution` → `@stigmer/agent-execution-ui`
- README updated

**Decision**: `-ui` suffix kept on all domain packages — UI components will be added to all domains (agent marketplace, skill catalog, MCP server browser).

## Session Progress (2026-03-15, Session 4)

### T06: Hook Pattern Contract — COMPLETED

**Design Document**: `design-decisions/003-hook-pattern-contract.md`
**Coding Guideline**: `coding-guidelines/query-command-hooks.md`

**Three-Layer Service Architecture**:
- Layer 1: Service factories (pure TS, no React) — `createXxxService(transport)`
- Layer 2: Service hooks (minimal React) — `useXxxService()` binds transport from context
- Layer 3: Query/Command hooks (console only) — TanStack Query (`useQuery`, `useMutation`, `useInfiniteQuery`)

**Key Decisions**:
- TanStack Query adopted at console level only — domain libraries stay lean and embeddable
- Rejected Planton's `usePlantonService()` bundling — domain hooks must not couple to UI concerns (notifications, loading indicators)
- Rejected Planton's "bag of functions" return shape — TanStack Query provides managed state instead
- Service factories always throw errors — never catch/swallow
- Notifications are the component's responsibility, not the hook's
- Transport unified on context-based approach — module-level singleton deprecated
- CQRS split by default, combined only when domain requires it (e.g., execution)

**Resolved Questions**:
- `useApproval` stays in domain library as custom hook (embeddable component, no TanStack Query dependency)
- Org-scoped queries: explicit `org` parameter at service factory level, contextual `useOrg()` wrapper at console level

**T09 Re-scoped**: `StigmerServiceBridge` as originally planned is unnecessary — loading, notifications, and org context are already handled by TanStack Query, components, and `OrgProvider`. T09 should focus on error interceptors only.

**Migration Mapping**: 9 existing hooks mapped to new pattern (8 via TanStack Query, 1 stays custom for streaming)

## Session Progress (2026-03-15, Session 3)

### T05: Navigation IA Design Decision — COMPLETED

**Design Document**: `design-decisions/002-navigation-ia.md`

**Sidebar Taxonomy** (7 items, 3 sections):
- Dashboard (top-level)
- Operations: Run Agent, Sessions
- Resources: Agents, Skills, MCP Servers
- Platform: Settings (hidden until Phase 8)

**Key Decisions**:
- Draft removed from sidebar — draft buttons on each resource list page
- Catalog deleted entirely — route, page, and orphaned code removed
- Brand name "Stigmer" (not "Stigmer Console"), use `site/public/logo-square.svg`
- Global header: logo + org switcher + theme toggle + user profile
- Breadcrumbs on all detail pages
- Workflows and Settings hidden until Phase 8

**Code Changes**:
- Deleted: `catalog/page.tsx`, `useUnifiedCatalog.ts`, `KindTabs.tsx`, `searchCatalog()` in search-service
- Updated: `navigation.ts` (sectioned structure), `Sidebar.tsx` (section headers, brand name), `page.tsx` (dashboard quick actions), `catalog/index.ts` (trimmed barrel)

**Verification**: `npm run build`, `npm run lint`, `npm run format:check` all pass clean.

### Session 2 (Earlier)

### T04: Visual Identity & Theme System — COMPLETED

**Brand Color System**
- Replaced monochrome `oklch(0 0 0)` primary with teal brand accent (OKLCH hue 190)
- Light: `oklch(0.55 0.12 190)`, Dark: `oklch(0.72 0.12 190)`
- Unified `--ring`, `--sidebar-primary`, `--sidebar-ring` with brand hue

**Semantic Status Tokens**
- Added `--success` (green, hue 150), `--warning` (amber, hue 80), `--info` (blue, hue 250)
- All tokens include light/dark variants and foreground pairs
- Mapped into Tailwind `@theme inline` in `globals.css`

**Dark Mode Activation**
- Installed `next-themes` for class-based dark mode with SSR flash prevention
- `ThemeProvider` wraps the provider tree as outermost provider in `Providers.tsx`
- Created `ThemeToggle.tsx` — three-way switcher (Light / System / Dark) using `resolvedTheme` for hydration safety
- Placed toggle in sidebar footer
- Added `suppressHydrationWarning` to `<html>` in `layout.tsx`

**Typography Audit**
- Verified heading hierarchy consistency across all pages
- Fixed 3 missing `font-mono` instances on qualified slugs (`AgentPicker.tsx`, `DraftPage.tsx`)

**Architecture Decision**: `next-themes` stays Console-specific — `@stigmer/theme` remains framework-agnostic CSS tokens only, preserving the platform-for-platforms mandate.

**Verification**: `npm run build`, `npm run lint`, `npm run format:check` all pass clean. Visually verified Dashboard, Catalog, and Run Agent pages in both light and dark modes.

### Session 1 (Earlier): Phase 1 — COMPLETED

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

### Key Decisions Made
1. **Kept OidcConfig and getIamApiAudience()** — they are future stubs for Auth0 integration
2. **Kept chart CSS variables** (--color-chart-1 through 5) — reserved for future chart/visualization features
3. **Kept Auth barrel re-exports and shadcn component variants** — part of public API surface / standard component primitives
4. **searchAgents was NOT dead code** — initial analysis flagged it incorrectly; `useAgentSearch.ts` depends on it. Caught by build verification.
5. **Teal as brand color** — differentiation from DevTools competitors, semantic fit with network/execution domain, strong OKLCH characteristics
6. **`next-themes` Console-only** — `@stigmer/theme` stays framework-agnostic, `ThemeProvider` lives in Console's provider tree
7. **Catalog removed** — unified catalog view is redundant with individual resource pages in sidebar. Cross-resource search deferred to Cmd+K.
8. **Draft contextual, not in sidebar** — draft buttons on resource pages, following Jakob's Law (GitHub, AWS, Kubernetes Dashboard convention)
9. **TanStack Query console-only** — domain libraries export service factories + hooks, no TanStack Query dependency. Keeps embeddable components lean.
10. **Rejected Planton's `usePlantonService()` bundling** — domain hooks must not couple to UI concerns (notifications, loading, page indicators). Violates architect mandate on domain purity.
11. **Three-layer service architecture** — service factory (pure TS) → service hook (transport binding) → query/command hook (TanStack Query). Already proven by `@stigmer/agent-execution-ui`.
12. **T09 re-scoped** — `StigmerServiceBridge` unnecessary with TanStack Query. T09 expanded to include full error handling framework: interceptors + display infrastructure.
13. **Non-blocking toast for server errors** — rejected Planton's global error modal pattern as disruptive. Sonner toast used instead.
14. **No event bus** — TanStack Query's cache-level handlers replace Planton's custom event bus pattern. Fewer moving parts, same coverage.
15. **Smart retry** — only `server` and `unavailable` errors retry once. Auth, permission, not-found, validation fail immediately. Mutations never retry.
16. **Session table Console-only** — `@stigmer/session-ui` keeps Layer 1 + Layer 2 only. The sessions list page table is Console-specific. Embeddable session components (replay viewer) are a separate future task with real usage guiding the API design.
17. **Scoped to API surface** — T12 builds only what the Session query API supports (pagination, agent filter). Sorting, text search, date range, status filter deferred — API gaps documented for server work.
18. **No session status column** — Session has no lifecycle status field; it's derived from the latest AgentExecution (N+1). Deferred until server adds denormalized `lifecycle_status`.
19. **Resource counts via domain search services** — 3 parallel `useQuery` calls through Layer 2 service hooks with `page: { num: 1, size: 1 }` + `select` for `totalCount`. Respects three-layer architecture, independent failure isolation per resource type.
20. **Execution status widgets deferred** — no aggregate execution endpoints exist. Dashboard shows resource counts (available now), not execution metrics (blocked on server API).

21. **Phase 7 scope revised** — Original plan called for `session-ui` and `catalog-ui` extraction. Revised to focus on `agent-ui` enrichment + Console list/detail polish. `catalog-ui` concept is obsolete (no unified catalog route). `session-ui` extraction deferred — no external embedding use case yet. Agent is the only domain with clear embedding needs (marketplace, admin dashboards).
22. **Two-tiered card strategy** — Domain card (`AgentCard`) accepts full `Agent` proto for embedding. Console search card (`AgentSearchCard`) accepts `SearchResult` for list pages. Different data access patterns, not duplication.
23. **Card grid for agents, list for skills/MCP servers** — Agents are browse/discover resources (marketplace pattern). Skills/MCP servers are operational, text-heavy resources better suited to compact list items.
24. **Internal primitives duplicated across domain packages** — `agent-ui` and `agent-execution-ui` each have their own `badge.tsx`, `collapsible.tsx`. Acceptable for small surface area, avoids coupling between packages. Shared primitive package deferred until 3+ packages duplicate the same component.

### Surprises Encountered
- `searchAgents` was initially removed alongside the genuinely dead `searchSkills` and `searchMcpServers`. Build failure revealed `useAgentSearch.ts` imports it. The function was immediately restored. Lesson: always verify each removal individually, not in batches.
- ESLint `react-hooks/set-state-in-effect` rule caught a `useState`/`useEffect` mount pattern in the initial `ThemeToggle` implementation. Refactored to use `resolvedTheme` directly from `next-themes` instead.

## Next Steps
1. ~~**T03: Package Rename** (`@stigmer/react-ui` → `@stigmer/agent-execution-ui`)~~ — **DONE**
2. ~~**T04: Visual Identity & Theme System**~~ — **DONE**
3. ~~**T05: Navigation IA Design Decision**~~ — **DONE** (design doc + catalog deletion + sidebar restructure)
4. ~~**T06: Define the Hook Pattern Contract**~~ — **DONE** (design decision + coding guideline)
5. ~~**T07+T08: Refactor Hooks + Service Reorganization**~~ — **DONE** (merged execution — 4 domain libraries, 14 hooks, 11 consumer updates)
6. ~~**T09: Error Handling Framework**~~ — **DONE** (3-tier: transport interceptors + TanStack Query retry + component display)
7. ~~**T11: Global Header, Sidebar Polish, Breadcrumbs**~~ — **DONE** (5 new components, 4 modified, 4 detail pages updated)
8. ~~**T12: Sessions Page**~~ — **DONE** (table layout, agent filter, pagination, empty/loading/error states; sorting/search/status deferred — API gaps documented)
9. ~~**T13: Dashboard Improvements**~~ — **DONE** (resource overview cards, trimmed quick actions, enhanced RecentSessions; execution status widgets deferred — server API gaps)

## Context for Resume
- Phases 1-7 are fully committed and verified
- Phase 7 complete: `@stigmer/agent-ui` enriched with `AgentCard` and `AgentOverview` components, Console list pages use domain-aware search cards, agents page uses card grid layout, all three detail views improved, deprecated code fully deleted
- The codebase now has: Prettier + hardened ESLint, teal brand color, dark mode, semantic status tokens, sectioned sidebar with collapse, global header, breadcrumbs, Query/Command hook pattern with domain libraries, three-tier error handling framework, reusable table primitives, sessions list page, dashboard with resource overview, embeddable agent components, domain-aware list rendering
- `transport.ts` and `org-service.ts` are fully deleted — zero deprecated transport code remains
- `OrgProvider` migrated to context-based transport (`useStigmerTransport()`)
- Cmd+K (global search) and notifications deferred to separate future tasks
- Server API gaps block execution status widgets — tracked for server-side work

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
| Phase 2 | 3–4 | Package rename + Visual identity foundation | Architecture + UX | **DONE** |
| Phase 3 | 5 | Navigation IA design decision + catalog cleanup | UX | **DONE** |
| Phase 4 | 6–9 | Query/Command hook pattern + service reorganization | Architecture | **DONE** |
| Phase 5 | 10–11 | Error handling & Bridge framework | Architecture | **DONE** |
| Phase 6 | 12–16 | Layout overhaul + View completeness (sidebar, header, sessions, dashboard) | UX | **DONE** |
| Phase 7 | 17–19 | Domain UI components + list/detail view enhancement | Architecture + UX | **DONE** |
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-03-15-session-10.md`
2. [ ] Check current task status — Phase 7 complete, Phase 8 (Workflow & IAM views) next
3. [ ] Review design decisions in `design-decisions/` (especially `003-hook-pattern-contract.md`)
4. [ ] Read coding guideline: `coding-guidelines/query-command-hooks.md` (includes error handling patterns)
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 8: Workflow & IAM views (deferrable), or Phase 9: Final polish & verification

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260315.02.web-architecture-alignment/next-task.md`

---

**Created**: 2026-03-15
**Updated**: 2026-03-15
**Current Task**: Phase 8 — Workflow & IAM Views (deferrable)
**Status**: READY — Phase 7 complete, Phase 8 next

---

*This file provides direct paths to all project resources for quick context loading.*
