# Task T01: Web Architecture & UX Alignment Plan

**Created**: 2026-03-15
**Updated**: 2026-03-15
**Status**: PENDING REVIEW
**Type**: Refactoring + UX
**Reference Analysis**: [Architecture Gap Analysis](24cd7e58-4eb7-4af1-9c91-3bd01fbe6cab), UX Gap Analysis (Temporal comparison)

> **This plan requires your review before execution.**

## Context

Two independent analyses revealed that Stigmer Web has a strong technical foundation (TypeScript strict mode, React 19, Next.js 16) but is missing both the **architectural patterns** that make a codebase consistent at scale and the **UX completeness** that makes a product feel state-of-the-art.

The architecture gaps were found by comparing with Planton Web. The UX gaps were found by comparing with Temporal's web console and evaluating against Nielsen's usability heuristics, cognitive laws (Fitts's, Hick's, Jakob's, Miller's), and the mandates in `_roles/006_ux_designer.md` and `_roles/004_web_ux_ui.md`.

**Key insight**: Architecture work (hooks, error handling, bridge) must come **before** UX work (new views, navigation overhaul) because the new views need those patterns to be built correctly. The plan is sequenced accordingly.

## Gap Summary

### Architecture Gaps

| Gap | Severity | Phase |
|-----|----------|-------|
| 45 unused exports, 3 dead files, routing bug | Hygiene | Phase 1 |
| No Prettier, no pre-commit hooks | Tooling | Phase 1 |
| `@stigmer/react-ui` misnamed for execution-only content | Naming | Phase 2 |
| No Query/Command hook pattern (CQRS on frontend) | Architecture | Phase 4 |
| No Bridge pattern beyond transport | Architecture | Phase 5 |
| No error handling framework (event bus, local scopes) | Architecture | Phase 5 |
| No domain library decomposition (everything in console) | Architecture | Phase 7 |

### UX Gaps (Nielsen Heuristic Violations)

| Gap | Heuristic Violated | Severity | Phase |
|-----|---------------------|----------|-------|
| Monochrome gray palette — no brand identity, no visual hierarchy through color | #8 Aesthetic & Minimalist Design | Medium | Phase 2 |
| No dark mode toggle despite tokens being defined | Jakob's Law (developer tools default to dark) | Medium | Phase 2 |
| Sidebar has only 4 items — hides product surface area | #6 Recognition over Recall | High | Phase 3 |
| Dual paths to resources (`/catalog` vs `/agents`, `/skills`, `/mcp-servers`) | #4 Consistency & Standards | High | Phase 3 |
| Dashboard card links to `/agents` but sidebar links to `/catalog` | #4 Consistency & Standards | High | Phase 1 |
| No global header (user profile, search, notifications, settings, theme toggle) | #1 Visibility of System Status | Critical | Phase 6 |
| No breadcrumbs or hierarchical navigation trail | #3 User Control & Freedom | Medium | Phase 6 |
| No org context indicator in main content area | #5 Error Prevention | Medium | Phase 6 |
| `/sessions` page renders empty `<div />` | #1 Visibility of System Status | Critical | Phase 6 |
| Dashboard shows actions but no system status (active executions, failures, pending approvals) | #1 Visibility of System Status | High | Phase 6 |
| No table/grid toggle for resource lists — cards only | #7 Flexibility & Efficiency | Medium | Phase 6 |
| No Cmd+K / global search | #6 Recognition over Recall, Fitts's Law | Medium | Phase 6 |
| No workflow views (entire pillar missing from web console) | Feature gap | High | Phase 8 |
| No IAM/settings views (org management, API keys, teams) | Feature gap | Medium | Phase 8 |

---

## Phase 1: Dead Code Removal & Tooling (Days 1–2)

Safe, non-breaking changes. No architectural decisions needed.

### T01: Remove Dead Code

- [ ] Delete unused files:
  - `src/components/ui/tooltip.tsx`
  - `src/components/ui/textarea.tsx`
  - `src/auth/oidc/types.ts`
- [ ] Remove unused exports (45 total):
  - Service type re-exports (`Agent`, `Skill`, `Session`, `McpServer`, `Client`, `createClient`, `ApiResourceKind`, `SearchResponse`, `SearchResult` from service files)
  - Unused service functions (`searchSkills`, `searchMcpServers` in `search-service.ts`)
  - Exported-but-internal-only option interfaces (`ListSessionsOptions`, `ListSessionsByAgentOptions`, `SearchResourcesOptions`, `SearchCatalogOptions`)
  - Auth barrel re-exports (`AuthUser`, `AuthMode`, `AuthState`, `AuthConfig` from `src/auth/index.ts`)
  - Unused hook return type exports (11 `Use*Return` / `Use*Options` interfaces)
  - Unused UI exports (`CardFooter`, `ScrollBar`, `badgeVariants`, `buttonVariants`)
  - Unused config/lib exports (`getIamApiAudience`, `NavEntry`, `formatDateTime`)
  - Unused prop interface (`AgentPickerProps`)
- [ ] Remove unused import (`import * as React` in `scroll-area.tsx`)
- [ ] Remove unused CSS variables (`--color-chart-1` through `--color-chart-5`)
- [ ] Fix routing bug: `src/app/page.tsx` links to `/agents` instead of `/catalog`

### T02: Add Prettier & Lint Hardening

- [ ] Install Prettier and create `.prettierrc`
- [ ] Add `format` and `format:check` scripts to `package.json`
- [ ] Add `@typescript-eslint/no-unused-vars: error` to ESLint config
- [ ] Add `@typescript-eslint/no-explicit-any: error` to ESLint config (or at least `warn`)
- [ ] Run Prettier across the codebase (single formatting commit)
- [ ] Run ESLint and fix any new violations
- [ ] *Optional*: Add husky + lint-staged for pre-commit hooks

**Checkpoint**: All dead code removed, linting tightened, Prettier formatting applied. Codebase compiles and runs identically.

---

## Phase 2: Package Rename + Visual Identity Foundation (Days 3–4)

Two independent workstreams that are both foundational for everything that follows. The package rename cleans up naming. The visual identity establishes the color system and dark mode that all subsequent UI work builds on.

### T03: Package Rename (`@stigmer/react-ui` → `@stigmer/execution-ui`)

- [ ] Rename directory `_libs/domain/react-ui/` → `_libs/domain/execution-ui/`
- [ ] Update `package.json` name from `@stigmer/react-ui` to `@stigmer/execution-ui`
- [ ] Update all imports in console `src/` from `@stigmer/react-ui` → `@stigmer/execution-ui`
- [ ] Update root `package.json` workspace references
- [ ] Update root `package.json` build scripts (`build:libs`, `clean:libs`)
- [ ] Update any CI/CD references
- [ ] Update `_libs/domain/react-ui/README.md`
- [ ] Verify build succeeds

### T04: Visual Identity & Theme System

**Why now**: Every subsequent view, component, and layout change will inherit these tokens. Establishing the color system now prevents rework later. This is the foundation that makes the product stop looking like a "default shadcn template."

**UX rationale**: Nielsen #8 (Aesthetic & Minimalist Design) — minimalism requires identity, not just absence of design. Jakob's Law — developer tools (Temporal, Grafana, VS Code, GitHub) all have distinctive color palettes and dark mode.

- [ ] **Brand color system**: Replace the fully monochrome `oklch(0 0 0)` palette with a brand-informed color system:
  - Choose a primary accent color (not gray) for `--primary` and `--sidebar-primary`
  - Define semantic status colors: `--success`, `--warning`, `--info` tokens (beyond just `--destructive`)
  - These are needed for execution status indicators, health badges, and system state
- [ ] **Dark mode activation**:
  - Add theme toggle component (system / light / dark)
  - Wire `next-themes` or equivalent for class-based dark mode switching
  - Add toggle to sidebar footer or global header (built in Phase 6)
  - Verify all existing components render correctly in dark mode
- [ ] **Typography refinement**:
  - Audit Geist Sans/Mono usage for visual hierarchy — ensure heading weights, sizes, and spacing create clear page structure
  - Ensure monospace font is used consistently for slugs, IDs, code, and YAML content

**Checkpoint**: Package renamed. Brand colors applied. Dark mode functional. Visual identity is established before building new views.

---

## Phase 3: Navigation Information Architecture (Day 5)

**Design decision phase — no coding.** Decide the sidebar taxonomy, route structure, and navigation patterns that all subsequent implementation work follows.

### T05: Navigation IA Design Decision

**Why now**: The sidebar is the user's map of the product. Every new view, route, and page built in Phases 6–8 depends on this taxonomy being settled. Building views without an agreed IA means rework.

**UX rationale**: Nielsen #6 (Recognition over Recall) — the sidebar must expose the product's full surface area. Miller's Law — group items into 5–9 categories. Jakob's Law — follow conventions from Temporal, Kubernetes Dashboard, and GitHub.

- [ ] **Decide sidebar taxonomy**. Proposed structure (requires review):
  ```
  ─── Operate ───────────────
  Run Agent          → /run
  Sessions           → /sessions
  ─── Resources ─────────────
  Agents             → /agents
  Skills             → /skills
  MCP Servers        → /mcp-servers
  Workflows          → /workflows        (Phase 8)
  ─── Create ────────────────
  Draft Skill        → /draft/skill
  Draft Agent        → /draft/agent
  Draft MCP Server   → /draft/mcp-server
  ─── Settings ──────────────
  Organization       → /settings/org     (Phase 8)
  Environments       → /settings/envs    (Phase 8)
  API Keys           → /settings/keys    (Phase 8)
  ```
- [ ] **Decide on `/catalog` vs individual resource routes**:
  - Option A: Keep `/catalog` as a unified search/discovery view, keep `/agents`, `/skills`, `/mcp-servers` as management views (both in sidebar)
  - Option B: Remove `/catalog`, make `/agents` etc. the primary routes with a unified search bar
  - Option C: Keep `/catalog` only, remove standalone routes
  - **Recommendation**: Option A — `/catalog` serves discovery (marketplace use case), individual routes serve management (operational use case). Both belong in the sidebar.
- [ ] **Decide breadcrumb structure**: e.g., `Resources > Agents > my-agent-slug`
- [ ] **Decide global header contents**: user profile, org context badge, global search (Cmd+K), notification bell, theme toggle, settings gear
- [ ] Document decision in `design-decisions/navigation-ia.md`

**Checkpoint**: Navigation IA agreed. All subsequent view work follows this structure.

---

## Phase 4: Query/Command Hook Pattern & Service Reorganization (Days 6–9)

This is the biggest architectural change. All new views built in Phase 6 depend on these hooks.

### T06: Define the Hook Pattern Contract

Design decision needed before coding. The pattern:

```typescript
// Query hook — reads only
function useAgentQuery() {
  return {
    query: {
      get: (id: string) => Promise<Agent>,
      list: (opts?: ListOptions) => Promise<Agent[]>,
      search: (text: string) => Promise<Agent[]>,
    }
  };
}

// Command hook — writes only
function useAgentCommand() {
  return {
    command: {
      create: (input: CreateAgentInput) => Promise<Agent>,
      update: (id: string, input: UpdateAgentInput) => Promise<Agent>,
      delete: (id: string) => Promise<void>,
    }
  };
}
```

- [ ] Document the hook pattern contract in `coding-guidelines/`
- [ ] Define standard return shapes, error handling, loading states
- [ ] Decide: do hooks manage loading/error state internally or delegate to a bridge?
- [ ] Decide: should hooks use `useStigmerService()` (like Planton's `usePlantonService()`) for notifications and loading?

### T07: Refactor Existing Hooks to Query/Command Pattern

Apply the pattern to each resource, one at a time:

- [ ] **Agents**: Refactor `useAgentDetail`, `useAgentSearch`, `useAgentSessions` → `useAgentQuery` + `useAgentCommand`
- [ ] **Sessions**: Refactor `useSessionDetail`, `useSessions` → `useSessionQuery` + `useSessionCommand`
- [ ] **Skills**: Refactor `useSkillDetail`, `useResourceCatalog` (skill portion) → `useSkillQuery`
- [ ] **MCP Servers**: Refactor `useMcpServerDetail`, `useResourceCatalog` (mcp portion) → `useMcpServerQuery`
- [ ] **Catalog**: Refactor `useUnifiedCatalog` → `useCatalogQuery`
- [ ] **Drafts**: Refactor `useDraftAgent` → `useDraftCommand`
- [ ] Update all component consumers to use new hook APIs

### T08: Reorganize Service Files

- [ ] Move service files from `src/services/` to domain-aligned locations (or keep flat but adopt consistent naming)
- [ ] Each service file exports a `create*Service(transport)` factory function
- [ ] Remove ad-hoc `createClient()` calls scattered in hooks
- [ ] Transport setup stays in `src/services/transport.ts`

**Checkpoint**: All hooks follow Query/Command pattern. Service files are consistent. Components updated.

---

## Phase 5: Error Handling & Bridge Framework (Days 10–11)

### T09: Add `StigmerServiceBridge` (Notification + Loading + Error)

Planton has `PlantonServiceBridge` that wires:
- `createRpcClient` — typed client factory
- `setPageLoading` — global loading indicator
- `openNotification` — toast/notification system
- `envInfo` — org/env context
- `createNotificationErrorDetails` — structured error display

- [ ] Create `StigmerServiceContext` in `@stigmer/rpc-client`
- [ ] Create `StigmerServiceBridge` in console that wires console-specific UI (toast, loading, org context) into the library context
- [ ] Create `useStigmerService()` hook that returns `{ rpcClient, setLoading, notify, orgInfo }`
- [ ] Wire Query/Command hooks to use `useStigmerService()` for loading + error feedback

### T10: Add Error Handling Interceptors

- [ ] Add `rpcServerErrorInterceptor` — unified handling for 5xx errors
- [ ] Add `rpcNotFoundInterceptor` — resource not found → notification
- [ ] Add `rpcPermissionDeniedInterceptor` — 403 → redirect or notification
- [ ] Add error event bus for cross-component error communication
- [ ] Add `createLocalErrorScope()` utility for component-level error handling

**Checkpoint**: Consistent error handling across all RPC calls. Loading states and notifications work via bridge.

---

## Phase 6: Layout Overhaul & View Completeness (Days 12–16)

This is the UX implementation phase. The architecture (hooks, error handling, bridge) is now in place. The navigation IA was decided in Phase 3. Now we build the shell and fill the views.

### T11: Global Header & Sidebar Redesign

**UX rationale**: Nielsen #1 (Visibility of System Status) — the user must always know who they are, what org they're in, and whether anything needs attention. Fitts's Law — primary actions must be large and close to focus.

- [ ] **Build global header bar** (`AppHeader` component):
  - Org context badge — prominent display of active organization (currently only in sidebar OrgSwitcher, easy to miss)
  - Global search trigger (Cmd+K shortcut) — opens a command palette for searching agents, sessions, skills, MCP servers by name
  - Notification indicator — bell icon with unread count for pending HITL approvals, failed executions, completed long-running agents
  - Theme toggle — light/dark/system (wired to Phase 2 dark mode)
  - User profile menu — avatar, name, email, sign out, link to API keys
- [ ] **Rebuild sidebar** per Phase 3 IA decision:
  - Group nav items into labeled sections (Operate, Resources, Create, Settings)
  - Expose all resource types as direct sidebar links (not hidden behind Catalog)
  - Add section headers/dividers for visual grouping
  - Add collapsed/expanded state persistence
- [ ] **Add breadcrumb component**:
  - Auto-generate from route path: `Resources > Agents > my-agent-slug`
  - Show in TopBar below page title
  - Clickable segments for upward navigation

### T12: Sessions Page (Currently Empty)

**UX rationale**: This is the most critical missing view. The page currently renders `<div />`. Users who click "Sessions" in the sidebar see nothing — a complete dead end that violates Nielsen #1 (Visibility of System Status).

- [ ] **Build sessions list view**:
  - Table layout (not cards) — sessions are operational data, not discovery items
  - Columns: session name/ID, agent name, status (active/completed/failed), started at, last activity, message count
  - Sortable columns (most recent first by default)
  - Filterable by: agent, status, date range
  - Search by session name or agent name
  - Pagination
  - Click row → navigate to `/sessions/[id]`
- [ ] **Empty state**: "No sessions yet. Run an agent to create your first session." with link to `/run`
- [ ] **Active sessions indicator**: If any sessions have running executions, show them prominently at the top (pinned rows or separate "Active" section)

### T13: Dashboard Improvements

**UX rationale**: The dashboard should answer "what is happening in my system right now?" not just "what can I do?" Nielsen #1 — the first screen must orient the user to current system state.

- [ ] **Status summary cards** (top of dashboard):
  - Active executions count (with "View" link → sessions filtered by active)
  - Pending HITL approvals count (with "Review" link → filtered view)
  - Failed executions in last 24h (with "Investigate" link)
  - Total agents registered
- [ ] **Recent sessions** (already exists, enhance):
  - Add status badge (running / completed / failed) to each session card
  - Add agent name to each card
  - Add duration or "running for X min" for active sessions
- [ ] **Quick actions** (already exists, keep as secondary section below status)

### T14: Resource List Information Density

**UX rationale**: Nielsen #7 (Flexibility & Efficiency of Use) — power users need dense table views, newcomers need card views. Hick's Law — default to the efficient option for returning users.

- [ ] **Add table/grid toggle** to resource list pages (`/agents`, `/skills`, `/mcp-servers`, `/catalog`):
  - Grid mode: current card layout (good for discovery, browsing)
  - Table mode: compact rows with sortable columns (good for management, scanning)
  - Persist preference in localStorage
  - Default: table for resource pages, grid for catalog
- [ ] **Table columns for agents**: name, slug, visibility, MCP server count, skill count, last updated
- [ ] **Table columns for sessions**: agent, status, message count, started, duration
- [ ] **Table columns for skills**: name, slug, state (Ready/Failed), tag, visibility
- [ ] **Table columns for MCP servers**: name, slug, transport type (stdio/HTTP), tool count, validation status

**Checkpoint**: Navigation redesigned. Sessions page functional. Dashboard shows system status. Resource lists have table mode.

---

## Phase 7: Domain Library Extraction (Days 17–19)

Now that views are complete and stable, extract them into reusable domain packages.

### T15: Extract `@stigmer/session-ui`

- [ ] Create `_libs/domain/session-ui/` package
- [ ] Move session-related components, hooks, and services from console
- [ ] Components: `SessionListView`, `SessionDetailPage`, etc.
- [ ] Hooks: `useSessionQuery`, `useSessionCommand`
- [ ] Service: `session-service.ts`
- [ ] Export public API via `index.ts`
- [ ] Update console imports

### T16: Extract `@stigmer/catalog-ui`

- [ ] Create `_libs/domain/catalog-ui/` package
- [ ] Move catalog-related components and hooks from console
- [ ] Components: `ResourceCard`, `ResourceList`, `CatalogEmptyState`, `KindTabs`
- [ ] Hook: `useCatalogQuery`
- [ ] Export public API
- [ ] Update console imports

### T17: Update Build Pipeline

- [ ] Add new packages to root `package.json` workspace config
- [ ] Add new packages to `build:libs` and `clean:libs` scripts
- [ ] Verify all packages build independently
- [ ] Verify console builds with new package structure

**Checkpoint**: 3 domain packages (`execution-ui`, `session-ui`, `catalog-ui`), each independently buildable.

---

## Phase 8: Workflow & IAM Surfaces (Days 20–24)

These are feature additions that depend on the full architecture and layout being in place. They fill the remaining product surface area gaps. Each is independently scoped and can be deferred if timeline is tight.

### T18: Workflow Views (Stub)

**UX rationale**: Workflows are one of Stigmer's two core pillars (the other being Agents). Their complete absence from the web console means half the product is invisible.

- [ ] **Workflow list page** (`/workflows`):
  - Table layout: name, status, last run, schedule (if any)
  - Link to workflow detail
- [ ] **Workflow detail page** (`/workflows/[id]`):
  - Workflow metadata (name, description, version)
  - Execution history table
  - DAG visualization of workflow tasks (can start as a placeholder, iterate later)
- [ ] **Add to sidebar** under Resources section
- [ ] Create `useWorkflowQuery` + `useWorkflowCommand` hooks following Phase 4 pattern

### T19: Settings & IAM Views (Stub)

**UX rationale**: Platform operators need self-service access to org management, environment configuration, API keys, and team management. Forcing these operations through CLI only is a UX gap for teams that prefer browser-based workflows.

- [ ] **Settings landing page** (`/settings`):
  - Organization details (name, slug, description, contact email)
  - Quick links to sub-pages
- [ ] **Environments page** (`/settings/envs`):
  - List environments in the current org
  - Create/edit environment
- [ ] **API Keys page** (`/settings/keys`):
  - List API keys with metadata (name, created, expiry, last used)
  - Create new key (show once, copy-to-clipboard)
  - Revoke key with confirmation
- [ ] **Team management** (`/settings/teams`) — optional, can defer:
  - List team members
  - Invite flow
  - Role assignment
- [ ] **Add to sidebar** under Settings section

**Checkpoint**: All product pillars have web console presence. Settings are self-service.

---

## Phase 9: Final Polish & Verification (Days 25–26)

### T20: Comprehensive Verification

- [ ] Run full ESLint pass — zero errors, zero warnings
- [ ] Run TypeScript compiler — zero errors
- [ ] Run Prettier check — all files formatted
- [ ] Manual smoke test:
  - Every page loads correctly
  - Navigation works (sidebar, breadcrumbs, back links)
  - Execution streaming works
  - Dark mode renders correctly on all pages
  - Global search returns results
  - Sessions list shows real data
  - Dashboard status cards populate
  - Table/grid toggle works and persists
- [ ] Verify `@stigmer/execution-ui` builds and publishes correctly
- [ ] Verify new domain packages build correctly
- [ ] Update README.md files for all new/changed packages

### T21: Cross-Surface Consistency Audit

**UX rationale**: Nielsen #4 (Consistency & Standards) — the same resource must look and behave the same everywhere it appears.

- [ ] Verify resource names, labels, and status terms are consistent across sidebar, breadcrumbs, page titles, and table headers
- [ ] Verify org context is visible and consistent across all views
- [ ] Verify error messages follow a consistent format (what happened, why, what to do)
- [ ] Verify all destructive actions (delete, revoke) show confirmation dialogs

**Checkpoint**: All success criteria met. Project complete.

---

## Success Criteria Checklist

| # | Criterion | Phase | Type |
|---|-----------|-------|------|
| 1 | All dead code removed | Phase 1 | Architecture |
| 2 | Prettier configured | Phase 1 | Architecture |
| 3 | Routing bug fixed | Phase 1 | Architecture |
| 4 | `@stigmer/react-ui` renamed to `@stigmer/execution-ui` | Phase 2 | Architecture |
| 5 | Brand color system applied (not monochrome gray) | Phase 2 | UX |
| 6 | Dark mode functional with toggle | Phase 2 | UX |
| 7 | Navigation IA decided and documented | Phase 3 | UX |
| 8 | Query/Command hook pattern adopted for all resources | Phase 4 | Architecture |
| 9 | Error handling bridge added | Phase 5 | Architecture |
| 10 | Global header with user profile, search, notifications | Phase 6 | UX |
| 11 | Sidebar redesigned per IA decision | Phase 6 | UX |
| 12 | Breadcrumbs on all detail pages | Phase 6 | UX |
| 13 | Sessions page fully functional (not empty) | Phase 6 | UX |
| 14 | Dashboard shows system status (not just actions) | Phase 6 | UX |
| 15 | Table/grid toggle on resource lists | Phase 6 | UX |
| 16 | At least 2 domain packages extracted beyond execution-ui | Phase 7 | Architecture |
| 17 | Workflow views present (at minimum list + detail stub) | Phase 8 | UX |
| 18 | Settings/IAM views present (org, envs, API keys) | Phase 8 | UX |

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking `@stigmer/react-ui` consumers during rename | Phase 2 is isolated; find-and-replace all imports before removing old paths |
| Scope creep from pattern adoption touching every file | Phase 4 is split by resource (agents, sessions, skills, etc.); each is an independent PR |
| Query/Command pattern doesn't fit all cases | T06 is a design decision task — agree on the contract before writing code |
| Bridge over-engineering | Start minimal (loading + notifications + org context). Add complexity only when needed |
| Domain extraction breaks circular dependencies | Map import graph before extracting. Use `no-restricted-imports` to enforce boundaries |
| Visual identity changes break existing views | Phase 2 tokens are additive (new accent colors, status colors); existing gray tokens remain valid. Dark mode is tested against all existing views before proceeding. |
| Navigation IA decision blocks implementation | Phase 3 is a dedicated design decision phase — resolve it before any view work begins in Phase 6 |
| Phase 8 (Workflows, IAM) is too large | Each view is independently scoped. Can ship stubs (list + detail) and iterate. Phase 8 is explicitly deferrable if timeline is tight. |
| Sessions page needs backend data | Sessions API already exists (used by `RecentSessions` component and session detail page). The gap is UI only, not backend. |

---

## Dependency Graph

```
Phase 1 (Dead code + tooling)
  └─► Phase 2 (Package rename + Visual identity)
        ├─► Phase 3 (Navigation IA decision — no code)
        │     └─► Phase 6 (Layout overhaul + Views — implements the IA)
        └─► Phase 4 (Query/Command hooks)
              └─► Phase 5 (Error handling + Bridge)
                    └─► Phase 6 (Views use hooks + error handling)
                          └─► Phase 7 (Extract stable views into packages)
                                └─► Phase 8 (New feature views — Workflows, IAM)
                                      └─► Phase 9 (Final verification)
```

**Read this as**: Phase 6 depends on both Phase 3 (IA decision) and Phase 5 (architecture). Phase 7 depends on Phase 6 (extract complete views, not half-built ones). Phase 8 depends on Phase 7 (follow the same patterns). Phase 9 verifies everything.

---

## Principles

1. **One concern per commit** — dead code removal, formatting, architecture changes, and UX changes are separate commits
2. **No behavior changes in Phase 1** — strictly removal and tooling
3. **Design before code** — agree on hook contract (Phase 4, T06) and navigation IA (Phase 3, T05) before implementing
4. **Each phase is independently shippable** — if we stop after Phase 5, the codebase is architecturally better; if we stop after Phase 6, the UX is dramatically better
5. **Reference Planton, don't copy Planton** — adapt patterns to Stigmer's domain and scale
6. **UX decisions are grounded in principles, not opinion** — every recommendation cites a specific heuristic, law, or benchmark

---

## Review Process

1. **You review this plan** — consider the phasing, the scope of each task, the dependency ordering, the risk mitigations
2. **Provide feedback** — anything to add, remove, reorder, or clarify
3. **I'll revise** — create `T01_2_revised_plan.md` incorporating your feedback
4. **You approve** — explicit go-ahead to begin Phase 1
5. **Execution begins** — tracked in per-task execution files
