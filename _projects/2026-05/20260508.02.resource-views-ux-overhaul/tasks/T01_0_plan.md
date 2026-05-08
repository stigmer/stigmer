# Task T01: UX Foundations — Status Tokens, Empty States, Action Menus, and Feedback Patterns

**Created**: 2026-05-08 15:51
**Status**: PENDING REVIEW
**Type**: Refactoring (Phase 0 of 5)

**This plan requires your review before execution**

## Context

This is the first task in a 5-phase project to overhaul all resource management screens in Stigmer. The full roadmap (derived from the deep research report at `_projects/2026-05/research.resource-views-ux-overhaul/04.report.gpt.md`) is:

| Phase | Focus | Estimated Effort |
|-------|-------|------------------|
| **0 (this task)** | UX foundations: status tokens, empty states, action menus, toast feedback, copy actions | 1-2 sessions |
| 1 | Resource Workbench: table/list/card views, filters, sort, bulk actions, inspector | 3-5 sessions |
| 2 | Detail pages as operational hubs: tabbed agents, skill editor, MCP tools/auth, runner full page | 4-6 sessions |
| 3 | Creation/edit modernization: manual wizards, AI sidecar, skill editor, import/export, templates | 5-8 sessions |
| 4 | Versioning, graphs, governance: version timeline, diff/rollback, dependency graph, audit log | 6-10 sessions |
| 5 | Power-user polish: Cmd+K command palette, keyboard shortcuts, saved filters, real-time updates | Ongoing |

Phase 0 focuses on small, high-value foundational changes that every subsequent phase will build on. These are low-risk, visible improvements that can ship independently.

## Objective

Establish foundational UX primitives in `@stigmer/react` that all resource screens will use: a consistent status badge system, contextual empty states, per-item action menus, toast/feedback patterns for mutations, and utility actions (copy ID, export config).

## Why Phase 0 First

1. **Every later phase depends on these primitives** — Phase 1's ResourceWorkbench needs status badges, empty states, and action menus. Phase 2's detail hubs need toast feedback and copy actions.
2. **Immediately visible improvement** — Users will see richer cards, better empty states, and actionable context menus across all existing views.
3. **Low risk** — These are additive changes, not architectural rewrites. Existing components keep working.
4. **Establishes design language** — Forces decisions on status colors, icon conventions, and interaction patterns that all subsequent phases follow.

## Task Breakdown

### 1. Resource Status Badge System

**What**: Create a shared `StatusBadge` component and status token system in `@stigmer/theme`.

**Current state**: Status indicators are ad-hoc per component — `SkillDetailView` has `SkillStateBadge` (Ready/Failed/Uploading), `RunnerListPanel` has phase dots, no shared vocabulary.

**Target**:
- Define status taxonomy: Ready, Running, Pending, Uploading/Indexing, Degraded, Failed, Disabled, Auth Expired, Draft
- Add `--stgm-status-*` CSS custom properties to `sdk/theme/src/tokens.css`
- Create `StatusBadge` component: color dot/icon + text + optional tooltip
- Every status uses color + icon + text (never color alone, per accessibility)

**Files to modify**:
- `sdk/theme/src/tokens.css` — add status token variables
- `sdk/react/src/internal/StatusBadge.tsx` — new shared component
- `sdk/react/src/index.ts` — export if public, or keep internal

### 2. Contextual Empty States

**What**: Replace generic "No X found" empty states with four contextual variants.

**Current state**: `ResourceListView` has a single `EmptyState` component with configurable icon/title/description. All empty states look the same regardless of cause.

**Target four variants**:
| State | Example | CTA |
|-------|---------|-----|
| First-use empty | "No agents yet. Create an agent to define instructions, tools, and skills." | Create agent |
| Filter zero-result | "No agents match these filters." | Clear filters |
| Permission empty | "You don't have access to agents in this org." | Request access / switch org |
| Error empty | "Could not load agents." | Retry |

**Files to modify**:
- `sdk/react/src/library/ResourceListView.tsx` — enhance `EmptyState` to accept a `variant` or richer props
- `sdk/react/src/internal/EmptyState.tsx` — extract to shared component usable beyond lists
- Per-resource list pages in `client-apps/web` — pass first-use CTAs and create actions

### 3. Per-Item Action Menus

**What**: Add kebab/three-dot context menus to resource list items with common actions.

**Current state**: `ResourceListView` has a `renderItemAction` slot, but only MCP servers use it (for a "Connect" button). No standard action menu pattern exists.

**Target**:
- Create `ResourceActionMenu` component (kebab icon, dropdown with actions)
- Standard actions per resource type:
  - **All**: Copy ID, Copy slug, Export JSON, View details
  - **Agents**: Edit, Duplicate, Run session, Change visibility, Delete
  - **Skills**: Change visibility, Delete
  - **MCP Servers**: Connect, Change visibility, Delete
- Right-click context menu support (optional, can defer)
- Destructive actions (delete) styled with danger color and use confirmation

**Files to modify**:
- `sdk/react/src/library/ResourceActionMenu.tsx` — new component
- `sdk/react/src/library/ResourceListView.tsx` — integrate action menu as default `renderItemAction`
- Resource-specific list pages — configure available actions per type

### 4. Toast/Feedback Patterns for Mutations

**What**: Standardize mutation feedback across all resource operations.

**Current state**: Some mutations use Sonner toasts (runner launch), others are silent. No consistent pattern.

**Target pattern**:
| Duration | Feedback |
|----------|----------|
| <1s | Optimistic update, no spinner unless risky |
| 1-10s | Inline spinner or progress toast |
| >10s | Progress toast + background operation |
| Failed | Inline error near source + toast summary |
| Destructive but recoverable | Undo toast (5s window) |
| Destructive permanent | Confirmation modal + final toast |

**Files to modify**:
- `sdk/react/src/internal/useMutationFeedback.ts` — new hook wrapping Sonner patterns
- Integrate into existing mutation hooks: `useUpdateVisibility`, `useDeleteRunner`, `useStopRunner`, `useCreateApiKey`, `useDeleteApiKey`, etc.

### 5. Copy and Export Utility Actions

**What**: Add "Copy ID", "Copy slug", "Copy as JSON/YAML" actions to resource detail views and list item menus.

**Current state**: No copy or export actions exist anywhere.

**Target**:
- `useCopyToClipboard` hook with toast confirmation
- "Copy ID" and "Copy slug" in action menus and detail page headers
- "Export as JSON" in detail page global action bar (prepares for Phase 2's full detail hub)

**Files to modify**:
- `sdk/react/src/internal/useCopyToClipboard.ts` — new hook
- Detail views (`AgentDetailView`, `SkillDetailView`, `McpServerDetailView`) — add copy actions to headers
- `ResourceActionMenu` — include copy actions

### 6. View Preference Persistence

**What**: Persist grid/list layout preference per resource type.

**Current state**: `ResourceListView` accepts a `layout` prop but it's hardcoded per page. User preference is not saved.

**Target**:
- Persist preference in localStorage keyed by resource type
- Add a view-mode toggle button in the list toolbar (grid/list icons)
- Pattern: `stigmer:library:{resourceType}:viewMode`

**Files to modify**:
- `sdk/react/src/library/ResourceListView.tsx` — add view toggle UI and persistence
- List pages in `client-apps/web` — pass resource type for storage key

## Success Criteria for T01

- [ ] Status badges use a shared component and consistent design tokens
- [ ] Empty states differentiate first-use, zero-results, permission, and error cases
- [ ] Resource list items have contextual action menus with at least: Copy ID, View details, Delete (with confirmation)
- [ ] Mutation operations show consistent toast feedback
- [ ] Copy-to-clipboard works for resource IDs and slugs
- [ ] Grid/list preference is persisted per resource type
- [ ] All changes are backward-compatible — no existing public API breaks
- [ ] All new components follow `--stgm-*` token system and work in dark mode

## Principles

1. **Additive, not destructive** — Enhance existing components, don't replace them yet
2. **SDK-first** — All primitives go in `@stigmer/react`, Console pages stay thin
3. **Accessible** — Every interactive element has keyboard support, focus management, and ARIA attributes
4. **Themeable** — All colors via `--stgm-*` tokens, no hardcoded values
5. **Ship incrementally** — Each sub-task (1-6) can be committed and shipped independently

## Next Task Preview

**T02: Resource Workbench** — Build the `ResourceWorkbench` shell component with table/list/card views, URL-synced filters, sorting, column visibility, selection, and bulk action bar. This replaces the current `ResourceListView` with a much richer browsing experience.

## Notes

- The deep research report is at `_projects/2026-05/research.resource-views-ux-overhaul/04.report.gpt.md`
- Reference Cloudscape's resource management patterns for design decisions
- **IMPORTANT**: Only document in knowledge folders after ASKING for permission

## Review Process

**What happens next**:
1. **You review this plan** — Consider the scope, ordering, and approach
2. **Provide feedback** — Any concerns, additions, or things to defer
3. **I'll revise** — Create T01_2_revised_plan.md incorporating feedback
4. **You approve** — Explicit approval to begin execution
5. **Execution begins** — Tracked in T01_3_execution.md
