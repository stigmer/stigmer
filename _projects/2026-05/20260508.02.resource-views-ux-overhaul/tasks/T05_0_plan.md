# Task T05: Phase 4 — Versioning, Graphs, Operational Insights

**Created**: 2026-05-09 19:30
**Status**: APPROVED
**Type**: Feature (Phase 4 of 5)

## Context

Phases 0–3 built the complete resource management foundation — status tokens, empty states, action menus, the `ResourceWorkbench` (table/card/list views, filters, sort, bulk actions), the `ResourceDetailShell` (tabbed detail hubs with action bars, confirm dialogs, delete flows), the `Tabs` component, multi-step creation wizards (Agent + MCP Server), skill upload/file-browser, template gallery, and YAML/JSON import/export.

Phase 4 transitions from **resource authoring** to **resource observability** — understanding how resources relate to each other (dependency graphs), how they've changed over time (version history for Skills), and what the diff looks like between versions. This phase also upgrades detail pages to use tabs properly, creating mounting points for these new views.

### Backend dependency assessment

| Concern | Current state |
|---------|---------------|
| Dependency data (Agent → MCP, Skills, Sub-agents) | **Available in `AgentSpec`** — no new backend needed |
| Skill version history storage | **Exists in `SkillAuditRepo`** — backend stores all versions, not yet exposed via RPC |
| Skill version listing | **Needs new `ListSkillVersions` RPC** — small addition, data already exists |
| Agent/MCP Server versioning | **Deferred** — GitOps (git history) covers most users today; will revisit after Skill timeline validates the UX |
| Audit log | **Deferred** — requires separate backend design work |
| Usage/cost charts | **Deferred** — separate project scope (analytics pipeline) |

### Key architectural decision: Defer Agent/MCP Server versioning

**Rationale**: Agent and MCP Server configs are declarative YAML applied via `stigmer apply`. Teams using GitOps already have version history in Git. Skills are different — they're content-addressed artifact packages pushed as ZIPs without a 1:1 YAML-in-repo equivalent. Skills genuinely need platform-managed versioning; Agents and MCP Servers may not. We will validate the version timeline UX with Skills first, then decide if extending to other resources is warranted based on real user demand.

## Phase 4 Sub-Tasks

Phase 4 is decomposed into 5 independently pickable sub-tasks. Dependencies are noted.

```
T05-A: Detail page tabbed infrastructure        (no dependencies)
T05-B: Agent dependency graph                   (depends on T05-A for tab mounting)
T05-C: Skill version timeline                   (depends on T05-A; needs backend RPC)
T05-D: Diff viewer for skill versions           (depends on T05-C)
T05-E: Backend API requirements document        (no dependencies — design spike)
```

---

### T05-A: Detail Page Tabbed Infrastructure

**Effort**: M (1 session)
**Dependencies**: None
**Backend required**: No

**What**: Upgrade `AgentDetailView` and `SkillDetailView` to use `ResourceDetailShell`'s built-in tab system. Currently `AgentDetailView` renders everything as one scrollable column with no tabs. Adding tabs creates the mounting points for the Dependency and Versions tabs.

**Why first**: Tabs are the structural prerequisite. Without them, the graph and version timeline have nowhere to live in the UI. This is small, non-breaking, and immediately improves information architecture.

**Proposed tab structures**:

Agent detail:
| Tab | Content | Status |
|-----|---------|--------|
| Overview | Current content: instructions, MCP usages, skills, sub-agents, env | Existing (restructured into tab) |
| Dependencies | Dependency graph (T05-B) | New — rendered when T05-B lands |

Skill detail:
| Tab | Content | Status |
|-----|---------|--------|
| Content | Current: file browser or rendered SKILL.md | Existing (restructured into tab) |
| Versions | Version timeline (T05-C) | New — rendered when T05-C lands |

MCP Server detail:
| Tab | Content | Status |
|-----|---------|--------|
| Configuration | Current: transport, env, auth sections | Existing |
| Capabilities | Current: tools/policies/resources (already tabbed internally) | Existing |

**Design decision**: Tabs that have no content yet (e.g., "Dependencies" before T05-B lands) will NOT be shown. Tabs only appear when their content component is available. No "coming soon" placeholders — that violates Nielsen's heuristic #8 (aesthetic and minimalist design) and promises features that don't exist.

**Changes**:

| File | Change |
|------|--------|
| `sdk/react/src/agent/AgentDetailView.tsx` | Wire `ResourceDetailShell` `tabs` prop with Overview tab (move current content there). Export a `tabs` registration mechanism so T05-B can add the Dependencies tab. |
| `sdk/react/src/skill/SkillDetailView.tsx` | Wire `ResourceDetailShell` `tabs` prop with Content tab (current file browser / rendered content). |
| `sdk/react/src/resource-detail/types.ts` | Consider if `TabRegistration` pattern is needed, or if tabs are simply passed as props from the consumer page. |

**Key design question to resolve during implementation**: Should the SDK component own its tab definitions (hardcoded in `AgentDetailView`), or should the Console page compose tabs from outside? Recommendation: the SDK component defines its own tabs (it knows its own content sections), but accepts an optional `additionalTabs?: TabItem[]` prop for consumers who want to add custom tabs.

**SDK impact**: Non-breaking — `AgentDetailView` and `SkillDetailView` continue to render the same content, now organized in tabs. New optional `additionalTabs` prop if we go with the extensibility pattern.

---

### T05-B: Agent Dependency Graph

**Effort**: L-XL (2-3 sessions)
**Dependencies**: T05-A (tab mount point)
**Backend required**: No

**What**: Build a visual dependency graph showing Agent → MCP Servers, Agent → Skills, Agent → Sub-Agents (with sub-agent recursion). Renders as the "Dependencies" tab on the Agent detail page. Built as a generic SDK component usable by platform builders.

**Data source**: Entirely from `AgentSpec` fields already fetched by `useAgent()`:
- `spec.mcpServerUsages[].mcpServerRef` — references to MCP Server resources
- `spec.skillRefs[]` — references to Skill resources
- `spec.subAgents[]` — inline sub-agent definitions with their own `mcpAccess[]` and `skillRefs[]`

**Graph modes** (from research report):

| Mode | Question it answers | Data requirement |
|------|--------------------|-|
| Dependency tree | "What does this agent depend on?" | Single agent's spec (already fetched) |
| Reverse lookup / blast-radius | "What breaks if I disable this MCP server?" | All agents in org (fetch via list) |

**Recommendation**: Start with **dependency tree only** (single-agent view). Blast-radius requires fetching all agents and is better suited as a feature on the MCP Server / Skill detail page ("Used by" section) — scope it separately if needed later.

**Architecture**:

```
sdk/react/src/dependency-graph/
  types.ts                    — DependencyNode, DependencyEdge, GraphData, NodeKind enum
  useDependencyGraph.ts       — Hook: takes AgentSpec → computes graph data structure
  DependencyGraph.tsx         — Styled component: renders the graph visually
  DependencyNode.tsx          — Individual node card (icon, name, kind badge, status dot)
  index.ts                    — barrel exports
```

**Rendering approach options** (NEEDS DECISION):

| Option | Bundle impact | Interactivity | License | Effort |
|--------|--------------|---------------|---------|--------|
| **Custom SVG + CSS layout** | ~0 KB (zero deps) | Minimal (static tree) | N/A | M — manual layout math |
| **dagre + custom SVG** | ~30 KB | Pan/zoom possible | MIT | M — dagre does layout, we render |
| **reactflow** | ~50 KB (tree-shakeable) | Full: pan, zoom, drag, minimap | MIT | L — most features, biggest dep |
| **elkjs** | ~180 KB | Layout only (need renderer) | EPL-2.0 | N/A — **license violation (DD-012)** |

**Recommendation**: Start with **custom SVG with a simple tree layout** (option 1). An agent's dependency tree is typically shallow (1-2 levels deep, 3-15 nodes). A full graph library is overkill for this initial scope. If users need pan/zoom for large graphs later, upgrade to dagre or reactflow behind `React.lazy` (DD-013).

**Interaction design**:
- Nodes are clickable → navigate to the referenced resource detail page
- Nodes show a status indicator (green dot = healthy, yellow = degraded, red = error) using existing `StatusBadge` pattern
- Sub-agents expand/collapse (they contain their own dependency subtree)
- Responsive: on narrow viewports, collapse to a flat dependency list

**SDK impact**: New public exports: `DependencyGraph`, `useDependencyGraph`, `DependencyNode` type, `GraphData` type. Platform builders can render an agent's dependency tree in their own dashboards.

---

### T05-C: Skill Version Timeline

**Effort**: L (2 sessions)
**Dependencies**: T05-A (tab mount point); requires backend RPC (T05-E spike informs, but implementation can proceed with mock data / optimistic design)
**Backend required**: Yes — `ListSkillVersions` RPC

**What**: Build a version timeline component showing the history of skill pushes. Each entry shows: version hash (truncated), push timestamp, actor, git provenance (if available), and the active tag. Renders as the "Versions" tab on the Skill detail page.

**Backend state**: The `SkillAuditRepo` in `stigmer-cloud` already stores all historical versions via `findAllBySkillId()`. The data exists — it just needs an RPC surface. In OSS (`stigmer-server`), the SQLite implementation would need a similar history table.

**Required RPC** (to be added to `apis/ai/stigmer/agentic/skill/v1/query.proto`):

```protobuf
// Proposed — subject to proto review
rpc listVersions(ListSkillVersionsInput) returns (ListSkillVersionsResponse);

message ListSkillVersionsInput {
  string org = 1;
  string slug = 2;
  // Optional pagination
  string page_token = 3;
  int32 page_size = 4;
}

message SkillVersionEntry {
  string version_hash = 1;
  google.protobuf.Timestamp pushed_at = 2;
  ApiResourceAuditActor pushed_by = 3;
  string tag = 4;               // tag at time of push (may have been moved since)
  bool is_current = 5;          // true if this is the active version
  GitProvenance git_provenance = 6;
  string message = 7;           // version message if provided
}

message ListSkillVersionsResponse {
  repeated SkillVersionEntry versions = 1;
  string next_page_token = 2;
}
```

**Frontend architecture**:

```
sdk/react/src/version-history/
  types.ts                      — VersionEntry (generic), SkillVersionEntry (specific)
  useSkillVersions.ts           — Data hook: fetches version list via SDK client
  VersionTimeline.tsx           — Generic timeline component (renders VersionEntry[])
  VersionTimelineEntry.tsx      — Single entry row (hash, time, actor, provenance)
  index.ts                      — barrel exports

sdk/react/src/skill/
  SkillVersionsTab.tsx          — Composes useSkillVersions + VersionTimeline for the detail page
```

**Component design (VersionTimeline)**:

```typescript
interface VersionEntry {
  id: string;
  timestamp: Date;
  actor?: { id: string; avatar?: string; displayName?: string };
  label: string;          // primary display text (e.g., truncated hash, tag)
  sublabel?: string;      // secondary text (e.g., git commit message)
  isCurrent?: boolean;
  metadata?: Record<string, string>;  // extensible key-value pairs for display
}

interface VersionTimelineProps {
  entries: VersionEntry[];
  onEntrySelect?: (id: string) => void;
  onCompare?: (fromId: string, toId: string) => void;
  selectedId?: string;
  compareIds?: [string, string];
  isLoading?: boolean;
  emptyMessage?: string;
}
```

**Key UX decisions**:
- Timeline flows top-to-bottom (newest first) — matches git log mental model
- Current/active version gets a highlighted badge
- Each entry shows relative time ("2 hours ago") with full timestamp on hover
- Git provenance (when available) shows commit hash link + branch name
- "Compare" mode: user selects two versions → triggers `onCompare` → opens DiffViewer (T05-D)
- The timeline is a generic SDK primitive — works for any versioned resource. Skill-specific data mapping happens in `useSkillVersions`.

**Implementation strategy**: Build the full frontend (hook + components) first. If the backend RPC isn't ready yet, the hook returns an empty state with a clear "Version history not available" message (graceful degradation). This allows frontend and backend work to proceed in parallel.

**SDK impact**: New public exports: `VersionTimeline`, `VersionTimelineEntry`, `VersionEntry` type, `useSkillVersions`. Platform builders can render skill version history in their own UIs.

---

### T05-D: Diff Viewer for Skill Versions

**Effort**: M-L (1-2 sessions)
**Dependencies**: T05-C (needs version selection to know which two versions to compare)
**Backend required**: Partial — needs `GetSkillVersion(org, slug, versionHash)` to fetch historical spec. May already be possible via `getByReference` with version parameter.

**What**: Build a diff viewer that shows what changed between two skill versions. Renders as a panel/dialog triggered from the version timeline's "Compare" action.

**What to diff**: Skill content is primarily `SKILL.md` (the skill's interface definition). Diffing two versions means:
1. Fetch version A's artifact (via `getArtifact` with version hash)
2. Fetch version B's artifact
3. Extract `SKILL.md` from each
4. Compute and render a text diff

**Architecture**:

```
sdk/react/src/version-history/
  DiffViewer.tsx              — Generic text diff renderer (unified or side-by-side)
  useDiff.ts                  — Behavior hook: computes diff from two text inputs
  types.ts                    — DiffLine, DiffHunk, DiffViewMode

sdk/react/src/skill/
  useSkillDiff.ts             — Fetches two skill artifacts, extracts SKILL.md, returns texts
  SkillDiffDialog.tsx         — Dialog composing useSkillDiff + DiffViewer
```

**Diff computation**: Use the `diff` npm package (MIT, ~8KB, well-maintained) for computing unified diffs. The rendering is custom (themed with `--stgm-*` tokens for added/removed/context lines).

**Display modes**:
- **Unified** (default): single column, additions in green, deletions in red, context in neutral
- **Side-by-side** (toggle): two columns for larger diffs

**Interaction**:
- Triggered from `VersionTimeline`'s compare mode (user selects two entries → "Compare" button)
- Opens as a dialog/panel overlay on the detail page
- Shows version A hash and version B hash in the header
- Line numbers for both sides
- Collapsible unchanged sections (show N hidden lines)

**Theme tokens needed**:
- `--stgm-diff-added-bg` / `--stgm-diff-added-fg`
- `--stgm-diff-removed-bg` / `--stgm-diff-removed-fg`
- `--stgm-diff-context-bg` (very subtle, nearly transparent)

**SDK impact**: New public exports: `DiffViewer`, `useDiff`, `DiffViewMode` type. Generic enough that when Agent/MCP versioning is added later, the same DiffViewer renders YAML diffs.

---

### T05-E: Backend API Requirements Document (Design Spike)

**Effort**: S (1 session — documentation, not code)
**Dependencies**: None
**Backend required**: This IS the backend design work

**What**: Write a formal API requirements document that specifies exactly what the backend needs to deliver for Phase 4 to be complete end-to-end. This document feeds into `stigmer-cloud` and `stigmer` (OSS) backend planning.

**Deliverables**:

1. **`ListSkillVersions` RPC specification** — exact proto definition, pagination, filtering, response shape, implementation notes for both Go (SQLite) and Java (MongoDB `skill_audit`)

2. **`GetSkillArtifactByVersion` clarification** — confirm whether the existing `getArtifact` RPC already supports fetching historical versions (it takes `artifactStorageKey` which is version-specific), or if a new RPC is needed

3. **Future: Agent/MCP versioning requirements** (informational, not for immediate implementation) — what would be needed IF we decide to add it: schema changes, storage, RPCs, migration considerations

4. **Audit log API shape** (informational) — what the frontend would need for a future audit log tab (event types, filtering, pagination)

**Output**: A markdown document in the project's `design-decisions/` folder (with your permission) that can be handed to backend work.

---

## Recommended Execution Order

```
Session 1:   T05-A  (Detail page tabs — small, unblocks everything)
Session 2-3: T05-B  (Dependency graph — highest user value, zero backend deps)
Session 4:   T05-C  (Skill version timeline — builds the timeline component + hook)
Session 5:   T05-D  (Diff viewer — completes the version history UX)
Session 6:   T05-E  (Backend spike doc — captures requirements for backend team)
```

T05-B is the highest-value deliverable (real operational insight, no backend needed). T05-C/D may run in parallel with backend RPC work — the frontend is designed to gracefully degrade if the RPC isn't ready.

## Principles (carried forward)

1. **SDK-first** — All components in `@stigmer/react`. Console pages are thin wrappers.
2. **Headless-first** — `useDependencyGraph`, `useSkillVersions`, `useDiff` are independently importable hooks. Styled components compose them.
3. **Generated types as source of truth** — Graph nodes reference `ApiResourceReference` types. Version entries map from proto `SkillVersionEntry`.
4. **Theme token compliance** — All visuals via `--stgm-*` tokens. Diff colors get dedicated tokens.
5. **No autonomous architecture decisions** — Surprises get surfaced. Graph library choice confirmed before implementation. Backend RPC shape reviewed before coding the hook.
6. **Accessible** — Graph has keyboard navigation (arrow keys between nodes). Timeline entries are focusable. Diff viewer has ARIA labels for added/removed context.
7. **Graceful degradation** — If backend RPCs aren't ready, hooks return empty states with clear messaging. No broken UI.
8. **License compliance (DD-012)** — No EPL/GPL deps in SDK packages. Any graph library must be MIT/Apache-2.0.
9. **Lazy loading (DD-013)** — If a graph library is added later (e.g., reactflow for complex graphs), it goes behind `React.lazy` as an optional peer dep.

## Success Criteria for Phase 4

- [ ] Agent detail page uses tabs (Overview tab with existing content)
- [ ] Skill detail page uses tabs (Content tab with existing content)
- [ ] Dependency graph renders Agent → MCP Servers, Skills, Sub-Agents as a visual tree
- [ ] Dependency graph nodes are clickable (navigate to resource)
- [ ] Skill version timeline renders push history (when backend RPC is available)
- [ ] Diff viewer shows text differences between two skill versions
- [ ] All new components are in `@stigmer/react` with clean public exports
- [ ] All new components work in dark mode and respect `--stgm-*` tokens
- [ ] All new components are keyboard-navigable and screen-reader friendly
- [ ] `make check` (typecheck + lint) passes clean after each sub-task

## Deferred Items (revisit after Phase 4)

| Item | Why deferred | Trigger to revisit |
|------|--------------|-------------------|
| Agent versioning | GitOps covers most users; validate UX with Skills first | User demand or Console-first editing becomes primary workflow |
| MCP Server versioning | Configs change rarely; GitOps covers it | Same as above |
| Blast-radius graph ("what breaks if I remove X") | Requires fetching all agents; better as MCP/Skill detail "Used by" section | After basic dependency tree proves valuable |
| Audit log | Requires dedicated backend pipeline | When compliance/governance becomes a user priority |
| Usage/cost charts | Requires analytics pipeline (separate project) | When billing/observability is scoped |
| Custom roles/permissions | IAM concern, not resource-views | When IAM overhaul is prioritized |

## Notes

- Phase 3 plan is at `tasks/T04_0_plan.md`
- Phase 2 plan is at `.cursor/plans/phase_2_detail_hubs_cd21ecab.plan.md`
- Phase 1 plan is at `.cursor/plans/t02_resource_workbench_927d6980.plan.md`
- Phase 0 plan is at `tasks/T01_0_plan.md`
- Research report at `research.resource-views-ux-overhaul/04.report.gpt.md` (sections on dependency graphs ~line 948, version history ~line 1255)
- **IMPORTANT**: Only document in knowledge folders after ASKING for permission
