# Agent Dependency Graph — Built-in Detail Tab

**Date**: May 9, 2026

## Summary

Added a visual dependency graph to the Agent detail page as a built-in conditional tab. The graph shows an agent's MCP servers, skills, and sub-agents (with recursive sub-agent dependencies) as an accessible CSS tree. The `DependencyGraph` component and `useDependencyGraph` hook are independently importable from `@stigmer/react` for platform builders.

## Problem Statement

Agent configurations can reference multiple MCP servers, skills, and sub-agents — each sub-agent with its own set of MCP access grants and skill refs. Understanding the full dependency structure required mentally parsing the raw spec fields or scrolling through separate sections in the Overview tab.

### Pain Points

- No visual representation of an agent's dependency topology
- Sub-agent dependencies (which MCP servers a sub-agent can access, which skills it uses) were buried inside collapsible sections
- Cross-org references (e.g., `other-org/shared-server`) were not called out visually
- Platform builders had no reusable hook to extract dependency data for their own UIs

## Solution

New `dependency-graph` module in `@stigmer/react` with a headless hook (`useDependencyGraph`) and a styled component (`DependencyGraph`). The graph is surfaced as a conditional built-in tab in `AgentDetailView` — it appears automatically when the agent has at least one dependency and hides when there are none (single-tab suppression preserved).

## Implementation Details

### New Module: `sdk/react/src/dependency-graph/`

| File | Purpose |
|------|---------|
| `types.ts` | `DependencyNode`, `NodeKind`, `DependencyTree`, props, and hook interfaces |
| `useDependencyGraph.ts` | Pure transformation hook: `AgentSpec` → `DependencyTree`. Zero fetching, memoized. |
| `DependencyGraph.tsx` | Accessible CSS tree container with WAI-ARIA tree roles and arrow-key navigation |
| `DependencyTreeNode.tsx` | Recursive node component: kind badges, connector lines, expand/collapse for sub-agents |
| `index.ts` | Barrel exports |

### Design Decisions

- **DD-T05B-001**: Built-in conditional tab, not a Console `additionalTab`. The dependency data is intrinsic to `AgentSpec` — all SDK consumers benefit, and existing `onMcpServerClick`/`onSkillClick` callbacks flow naturally.
- **DD-T05B-002**: CSS tree layout (not SVG spatial graph). Agents typically have 3-15 nodes at 1-2 levels of depth. CSS is accessible, responsive, zero-dep.
- **DD-T05B-003**: No status indicators in v1. Showing resource health would require N+1 fetches. Deferred until a batch status endpoint exists.
- **DD-T05B-004**: Tree semantics (not DAG). The same MCP server in parent and sub-agent is shown in both locations — matching the mental model "what does THIS agent use?"

### AgentDetailView Integration

- `AGENT_BUILT_IN_TABS` (static const) → `builtInTabs` (memoized, conditionally includes "Dependencies")
- `handleNodeClick` routes `mcp-server` nodes to `onMcpServerClick` and `skill` nodes to `onSkillClick`
- Zero Console changes required — `AgentDetailPage.tsx` already passes the required callbacks

### Accessibility

- `role="tree"` / `role="treeitem"` / `role="group"` ARIA structure
- `aria-expanded` on collapsible sub-agent nodes
- Arrow-key navigation (Up/Down between siblings, Home/End to jump, Left/Right to collapse/expand)
- Kind badges use `--stgm-status-*` tokens — never color-only communication

## Benefits

- **For users**: Instant visual understanding of agent dependency structure without parsing raw config
- **For platform builders**: `useDependencyGraph` hook returns structured tree data independently of the styled component — full control over rendering
- **For maintainability**: Zero new external dependencies; all rendering is CSS + HTML. Module follows established SDK patterns (headless hook + styled component).

## Impact

- `@stigmer/react` — new public exports: `DependencyGraph`, `useDependencyGraph`, `DependencyNode`, `DependencyTree`, `NodeKind`, plus props/return types
- `AgentDetailView` — non-breaking: agents with zero deps see no visual change; agents with deps get a new "Dependencies" tab
- Console — zero changes
- Bundle impact: ~5KB (pure React + CSS, no external graph library)

## Related Work

- T05-A: Detail Page Tabbed Infrastructure (prerequisite — provided `useDetailTabs` and `additionalTabs` API)
- Phase 4 plan: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T05_0_plan.md`
- Next: T05-C (Skill Version Timeline) and T05-D (Diff Viewer)

---

**Status**: Production Ready
**Commit**: `134c5ea15`
