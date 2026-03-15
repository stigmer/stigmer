# Domain UI Components + List/Detail View Enhancement

**Date**: March 15, 2026

## Summary

Enriched the `@stigmer/agent-ui` domain library with embeddable card and overview components, replaced the generic resource card system with domain-aware rendering across all three resource types, improved skill and MCP server detail views, and completed the cleanup of all deprecated singleton transport code. This brings the web console closer to a marketplace-quality browsing experience for agents while maintaining architectural purity for third-party embedding.

## Problem Statement

Phase 7 of the web architecture alignment project needed to decompose UI components into domain libraries. The original plan called for extracting `session-ui` and `catalog-ui`, but both were poor candidates — the unified catalog route had already been removed (Phase 3), and sessions had no external embedding use case.

### Pain Points

- `ResourceCard` was a generic component rendering all resource types identically — no domain-specific fields (tool counts, sub-agents, visibility badges)
- Agent list pages used a flat list layout despite agents being browse/discover resources that benefit from card grids
- `AgentDetailView` was monolithically coupled to Console UI, making it impossible to embed agent detail content elsewhere
- Skill and MCP server detail views lacked state badges, provenance metadata, and discoverd capabilities display
- The deprecated `transport.ts` (singleton) and `org-service.ts` (legacy) were still referenced by `OrgProvider`

## Solution

Revised Phase 7 to focus on the domains with real embedding value: enriched `@stigmer/agent-ui` with `AgentCard` (card) and `AgentOverview` (detail content), created Console-specific search cards for all three resource types, and improved detail views in-place. Cleaned up all deprecated code.

## Implementation Details

### Part A: `@stigmer/agent-ui` Domain Components

- Added internal primitives (`badge.tsx`, `collapsible.tsx`, `section.tsx`) following the `agent-execution-ui` pattern — bundled, unexported, self-sufficient
- `AgentCard`: Accepts full `Agent` proto, renders icon/name/qualified-slug/description/MCP-server-count/skill-count/sub-agent-count/visibility-badge/tags. Framework-agnostic (`onClick`/`href` props, no `next/link`)
- `AgentOverview`: Extracted core detail view content from `AgentDetailView`. Renders header, collapsible long instructions, MCP server usages with tool badges, skill refs, sub-agents with model overrides
- Added `styles.css` with Tailwind v4 + `@stigmer/theme/tokens.css` for embeddable styling
- Updated `package.json`: `./styles.css` export path, peer dependencies for `@base-ui/react`, `class-variance-authority`, `lucide-react`

### Part B: Console List View Enhancement

- `AgentSearchCard`: Card-style layout for grid display, renders `SearchResult` data with icon, visibility badge, tags, and relative timestamp
- `SkillSearchCard`: Compact list-item layout with tag badge, description, and navigation chevron
- `McpServerSearchCard`: Compact list-item layout with tags, timestamp, and navigation chevron
- `ResourceList`: Refactored with `renderItem` render-prop and `layout` prop ("list" | "grid"), replaces the old generic `ResourceList` from `components/catalog/`
- `ResourceEmptyState`: Domain-aware empty state component (query vs no-content variants)
- Agents page: Responsive card grid (1/2/3 columns). Skills and MCP Servers: list layout

### Part C: Detail View Improvements

- `AgentDetailPage`: Thin shell composing `TopBar`, `AgentOverview` (from domain library), Run Agent button, and `AgentSessionHistory`
- `SkillDetailView`: Added `SkillState` badges (Ready/Uploading/Failed), git provenance section with remote URL/ref/commit/subdir, markdown rendering for SKILL.md content
- `McpServerDetailView`: Added stats row (tool count, template count, discovery source/timestamp), environment variables section, refined spacing and grouping

### Part D: Cleanup

- Migrated `OrgProvider` to `useStigmerTransport()` — last consumer of the deprecated singleton transport pattern
- Deleted `services/transport.ts`, `services/org-service.ts`, `components/agent/AgentDetailView.tsx`
- Deleted entire `components/catalog/` directory (4 files)

## Benefits

- **Embeddable agent UI**: Third-party platforms can render agent cards and overviews without Console dependencies
- **Domain-specific rendering**: Each resource type now displays its unique fields (tool counts for agents, state badges for skills, discovery metadata for MCP servers)
- **Browse-optimized layout**: Card grid for agents matches marketplace browsing patterns (npm, Docker Hub)
- **Zero deprecated code**: All singleton transport references removed — codebase is fully migrated to context-based transport
- **Net code reduction**: -474 lines (718 deleted, 244 added) — more capability with less code

## Impact

- **Agent marketplace readiness**: `AgentCard` and `AgentOverview` are ready for use in agent picker, marketplace, and admin dashboard contexts
- **Console UX**: Resource browsing experience is now differentiated by domain rather than generic
- **Architecture**: Clean separation between embeddable domain components (proto-based) and Console search cards (SearchResult-based)
- **Maintainability**: Deprecated code fully removed, no dual transport patterns to maintain

## Related Work

- [Three-Layer Service Architecture](2026-03-15-165841-web-phase4-three-layer-service-architecture.md) — The domain library foundation this work builds upon
- [Error Handling Framework](2026-03-15-172120-web-error-handling-framework.md) — ErrorMessage component used in refactored detail pages
- [Dashboard Improvements](2026-03-15-181752-web-dashboard-improvements.md) — Resource counts using the same domain service hooks

---

**Status**: Production Ready
**Timeline**: Phase 7 of web architecture alignment (1 session)
