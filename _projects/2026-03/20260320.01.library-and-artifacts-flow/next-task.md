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

## Next Steps

1. **T01.6 — `ResourceListView` component**: Generic list with search + scope (next up)
2. **T01.7 — `ResourceCountCard` component**: Landing page card with count
3. **T01.8 — Barrel exports for library module** (partial — `ScopeToggle` already exported)
4. Continue through T01.9–T01.13 (sidebar, pages)

## Context for Resume

- **Data layer complete** (T01.1–T01.4): list hooks + count hooks, all scope-aware
- **First UI component complete** (T01.5): `ScopeToggle` in the new `library/` module
- The `library/` module now exists at `sdk/react/src/library/` with barrel exports
- `ResourceListScope` type flows cleanly: `ScopeToggle` → data hooks → SDK client
- **Next work is `ResourceListView`** — the generic list component that composes `ScopeToggle` + search input + paginated list rendering
- Branch: `feat/add-customize-ui-2`
- Note: Working directory has uncommitted changes from the secrets-flow-hardening project (OneTimeSecrets) alongside the Library changes

## Quick Commands

After loading context:
- "Continue with T01.6" — Implement ResourceListView component (generic list with search + scope)
- "Continue with T01.7" — Implement ResourceCountCard component
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
