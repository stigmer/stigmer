# AgentDetailView — First Resource Detail View Component

**Date**: March 20, 2026

## Summary

Built `AgentDetailView`, the first embeddable detail view component for the Library, as an SDK component in `@stigmer/react`. This component renders a complete read-only view of an Agent blueprint with 6 structured sections, cross-resource linking, and full loading/error/not-found state handling. Alongside the component, a Console page at `/library/agents/[slug]` and list-to-detail navigation wiring complete the vertical slice.

## Problem Statement

The Library had list pages for Agents, Skills, and MCP Servers, but no detail views. Clicking a resource in the list had nowhere to go. Platform builders embedding the SDK had data hooks (`useAgent`, `useSkill`, `useMcpServer`) but no styled component to render the fetched data.

### Pain Points

- Users could browse resources but not inspect their configuration
- The `onItemClick` prop on `ResourceListView` was supported but never wired by any list page
- No embeddable detail component existed for platform builders who wanted a drop-in Agent inspector

## Solution

Built a full vertical slice for Agent detail: SDK component, Console page, and list wiring — following the established SDK-first architecture where the component lives in `@stigmer/react` with zero Console dependencies.

## Implementation Details

### AgentDetailView (`sdk/react/src/agent/AgentDetailView.tsx`)

A self-contained SDK component that uses `useAgent(org, slug)` internally to fetch and render an Agent blueprint in structured sections:

1. **Header** — Name, org, visibility badge, icon (from URL or fallback SVG), audit timestamps, description
2. **Instructions** — Collapsible monospace block (8-line threshold), "Show more"/"Show less" toggle
3. **MCP Server Usages** — Cross-linked list with tool count and approval override summary
4. **Skills** — Cross-linked list of skill references
5. **Sub-Agents** — Expandable disclosure sections with nested instructions, MCP access, skill refs, model override
6. **Environment Variables** — Alphabetically sorted table with secret/config badge

Sections with no data are omitted entirely (aesthetic-minimalist heuristic). Cross-resource linking is routing-agnostic via `onMcpServerClick` / `onSkillClick` callback props.

### Console Page (`client-apps/web/src/app/library/agents/[slug]/`)

Thin client wrapper: reads `slug` from `useParams()`, `org` from `useActiveOrgSlug()`, wires callbacks to `router.push()`.

### List Wiring (`AgentListPage.tsx`)

Added `onItemClick={(item) => router.push(`/library/agents/${item.slug}`)}` — 3 lines changed.

## Benefits

- Platform builders can embed `<AgentDetailView org="acme" slug="my-agent" />` with zero configuration
- Cross-resource links are wired via callback props, keeping the component routing-agnostic
- Patterns established (Section wrapper, Header, loading/error/not-found, cross-linking) will accelerate SkillDetailView and McpServerDetailView implementation
- Agent list items are now clickable, completing the browse-to-detail navigation flow

## Impact

- **SDK consumers**: New `AgentDetailView` component and `AgentDetailViewProps` type exported from `@stigmer/react`
- **Console users**: Can now click any agent in the Library list to see its full configuration
- **Round 2 readiness**: Patterns proven for Skill and McpServer detail views

## Related Work

- Builds on: `2026-03-20-183646-sdk-single-resource-data-hooks.md` (useAgent hook)
- Part of: 20260320.03.sp.resource-detail-views sub-project (Phase 5 of library-and-artifacts-flow)
- Next: SkillDetailView + McpServerDetailView (Round 2)

---

**Status**: Production Ready
**Timeline**: 1 session (Round 1 of 2)
