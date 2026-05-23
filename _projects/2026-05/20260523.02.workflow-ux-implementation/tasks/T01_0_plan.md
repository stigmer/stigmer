# Task Plan: Workflow UX Implementation

**Created**: 2026-05-23
**Status**: PENDING REVIEW
**Source**: Deep research report at `_projects/2026-05/20260523.01.workflow-ux-overhaul/research.workflow-ux-state-of-the-art/04.report.gpt.md`

## Executive Summary

Rewrite the workflow UX layer — execution visualization, visual editor node system, auto-layout, task insertion, inspector panel, overview page, and monitoring — based on the deep research findings. Keep `@xyflow/react`, the command/history pattern, YAML DSL, and Temporal runtime. Rewrite the node grammar, execution viewer, layout pipeline, and insertion UX. Every deliverable includes integrated Playwright E2E tests.

## Architecture Principle

**One semantic workflow model → three rendering modes:**

```
Design mode    = editable graph + inspector + YAML sync
Overview mode  = readable graph + summaries + recent health
Execution mode = read-only graph + live status + runtime inspector + timeline
```

All three modes share the same `WorkflowSemanticModel`, `TaskTypeRegistry`, and `GraphViewModel`. This eliminates the current disconnect between design and execution.

---

## Phase 0: Foundation (Week 1)

### T01: Task Type Visual Registry

**Goal**: Create the centralized `TaskTypeDefinition` registry that owns all type-specific behavior — shapes, icons, ports, default configs, inspector components, validation, and execution overlay rendering.

**Deliverables**:
- `TaskTypeDefinition` interface with: kind, category, label, description, visual spec (shape, icon, default size), ports function, default config, inspector component, validate function, YAML serialization, execution overlay, layout hints
- `TaskTypeVisualSpec` with shape enum: `task-card`, `decision-diamond`, `parallel-bar`, `event-circle`, `terminal-pill`, `subworkflow-card`, `container`
- Registry populated for all 20 task kinds with correct shape/icon mappings
- Shape → task kind mapping per research report recommendations:
  - Agent Call / LLM Call / Evaluate → rounded rectangle card
  - Switch Case → diamond
  - Fork → thick horizontal bar
  - Human Input → octagon/gate shape
  - Wait → circle with clock
  - Listen / Raise Error → event circle
  - HTTP / gRPC / Activity / Run Workflow → rectangle with service icon
  - Set Variables / Transform / Validate → data card
  - For Each → rounded container with loop marker
  - Try/Catch → container with shield marker
  - Start / End → terminal pills (existing)

**E2E Tests** (`test/e2e/tests/functional/workflow-node-shapes.spec.ts`):
- Verify each task type renders with its correct shape class on the canvas
- Verify icons are present and distinguishable per task type
- Verify accessibility: ARIA labels include task type and name
- Verify non-color differentiation (shape + icon + text badge, not color alone)

---

### T02: NodeShell Component — Shape Rendering

**Goal**: Replace the single `CanvasTaskNode` with a `WorkflowNode` component that delegates to a `NodeShell` for shape rendering based on the visual registry.

**Deliverables**:
- `NodeShell` component that renders SVG outlines based on `visualClass` (diamond, bar, circle, octagon, card, pill)
- `NodeHeader` component with icon, name, kind badge, and semantic chips
- Port/handle rendering driven by task type registry `ports()` function
- Status overlay slot for execution mode
- Validation error badge rendering
- Selection states: default, hovered, selected, multi-selected, error
- CSS variable theming via `--stgm-*` tokens

**E2E Tests** (`test/e2e/tests/functional/workflow-node-rendering.spec.ts`):
- Verify diamond shape renders for switch_case nodes
- Verify parallel-bar shape renders for fork nodes
- Verify octagon shape renders for human_input nodes
- Verify selection highlight and hover states
- Verify validation error badge appears on invalid nodes

---

### T03: ELK Layout Pipeline

**Goal**: Replace dagre with ELK Layered as the primary auto-layout engine. Implement workflow-aware preprocessing (semantic structure identification, port assignment, layout hints).

**Deliverables**:
- `elkjs` dependency added, running in a Web Worker
- Workflow-aware layout preprocessor: identify linear chains, switch groups, fork/join groups, foreach containers, try/catch regions
- Port assignment: input top, normal output bottom, branch outputs ordered left-to-right, catch/error output right
- ELK configuration: layered algorithm, top-to-bottom, orthogonal routing, fixed-side ports, crossing minimization
- Layout metadata storage (`x-stigmer-ui` in YAML or separate store)
- Manual pin preservation (user-positioned nodes stay put)
- Three layout scopes: auto-layout all, auto-layout selected, tidy branch/downstream
- `GraphCommand.layoutPolicy` property: `none`, `affected-subgraph`, `downstream`, `whole-graph`
- Keep dagre as fallback for simple/emergency layout

**E2E Tests** (`test/e2e/tests/functional/workflow-layout.spec.ts`):
- Verify auto-layout produces no overlapping nodes for a 10-node linear workflow
- Verify switch branches layout left-to-right correctly
- Verify fork branches get equal lane spacing
- Verify "Auto-layout" button triggers ELK re-layout
- Verify layout is stable (running auto-layout twice produces same result)

---

## Phase 1: Execution Visualization (Week 2)

### T04: Read-Only Execution Canvas

**Goal**: Replace the log-based execution page with a read-only React Flow scene that reuses the workflow's saved layout. Add live node status overlays.

**Deliverables**:
- `WorkflowGraphMode` type: `"design" | "overview" | "execution"`
- Unified `WorkflowGraph` component with mode-specific capabilities:
  - Design: draggable, connectable, editable, plus buttons, inspector config
  - Overview: pannable/zoomable, task summary popovers, health badges
  - Execution: read-only, status overlays, branch highlighting, runtime inspector
- Execution canvas renders against **workflow version snapshot** (not latest draft)
- Version mismatch banner: "This run used version 12. You are viewing draft version 14."
- Node execution state overlays with vocabulary:
  - Not reached → muted/low opacity
  - Pending → neutral outline, clock badge
  - Running → animated outline or progress ring
  - Streaming → running + live text/token indicator
  - Waiting for human → person badge, amber outline
  - Completed → check badge, success outline
  - Failed → error badge, red outline, auto-selected
  - Retrying → attempt badge, circular arrow
  - Skipped → dimmed, "skipped" chip
  - Cancelled/timed out → stop/timeout badge

**E2E Tests** (`test/e2e/tests/interactive/workflow-execution-graph.spec.ts`):
- Verify execution page renders the workflow graph (not just logs)
- Verify completed nodes show success checkmark
- Verify failed nodes show error badge and are auto-selected
- Verify running nodes show animated indicator
- Verify clicking a node opens the runtime inspector
- Verify "Streaming..." indicator appears for active agent calls

---

### T05: Runtime Inspector Panel

**Goal**: Build a dedicated runtime inspector that shows per-node execution details when a node is clicked in the execution canvas.

**Deliverables**:
- Runtime inspector tabs: Summary, Input, Output, Stream, Error, Retries, Logs, Raw Events
- Summary tab: status, attempt count, duration, cost, token count, start/end times
- Input tab: rendered input data
- Output tab: rendered output data (or partial output for failed/streaming)
- Stream tab: live transcript for agent calls with tool-call timeline entries
- Error tab: error type, message, stack reference, retryable flag
- Retries tab: attempt history with duration, error, backoff
- Logs tab: filtered event log for this node
- Raw Events tab: Temporal event IDs and metadata (developer/debug view)
- Token/cost chips on the node card (compact: `$0.19 · 12.4k tokens · 1m 12s`)

**E2E Tests** (`test/e2e/tests/interactive/workflow-execution-inspector.spec.ts`):
- Verify clicking a completed node shows Input and Output tabs with data
- Verify clicking a failed node shows Error tab with error details
- Verify cost and duration are displayed in the summary
- Verify retries tab shows attempt history when retries occurred

---

### T06: Branch and Parallel Execution Highlighting

**Goal**: Visualize taken/untaken branches in switch_case and simultaneous execution in fork nodes.

**Deliverables**:
- Switch Case execution: taken branch edge stays bright, untaken branches dimmed with "not taken" label
- Decision inspector: evaluated expression, chosen case, default fallback
- Fork execution: multiple branch edges active simultaneously, join node shows "N/M completed"
- For Each execution: collapsed summary ("100 iterations · 92 succeeded · 5 failed · 3 running"), expandable iteration viewer
- Edge rendering: active edges bright, completed edges solid, dimmed edges for untaken paths

**E2E Tests** (`test/e2e/tests/interactive/workflow-execution-branches.spec.ts`):
- Verify taken switch branch is highlighted while untaken branches are dimmed
- Verify fork shows multiple running branches simultaneously
- Verify join node shows completion progress (N/M)

---

### T07: Execution Waterfall Timeline

**Goal**: Add a bottom panel waterfall timeline showing temporal execution progression alongside the graph.

**Deliverables**:
- Waterfall timeline component showing: queue delay, execution time, streaming time, wait time, retry backoff
- Timeline synchronized with graph selection (selecting a node scrolls timeline, clicking timeline entry selects node)
- Compound bars: separate waiting from execution
- Zoom for long-running functions
- "Follow execution" toggle to auto-scroll
- Retry attempt detail in timeline

**E2E Tests** (`test/e2e/tests/interactive/workflow-execution-timeline.spec.ts`):
- Verify timeline renders with execution events
- Verify clicking a timeline entry selects the corresponding graph node
- Verify "Follow execution" toggle works

---

## Phase 2: Editor Interactions (Week 3)

### T08: Contextual Task Picker — Plus Button Fix

**Goal**: Replace hardcoded agent_call insertion with a contextual, searchable task picker for all add interactions.

**Deliverables**:
- Unified `TaskPickerPopover` with: search, category grouping, recent/favorites, compatibility suggestions
- Three distinct add interactions:
  1. **Edge plus**: "Insert between A and B" → opens picker → `InsertNodeOnEdgeCommand`
  2. **Node output plus**: "Add after" → opens picker → `AppendNodeCommand`
  3. **Branch plus**: "Add case" (switch), "Add parallel branch" (fork), "Add catch handler" (try/catch)
- Suggested task types based on upstream output context
- Disabled entries with explanations (e.g., "Fork unavailable: cannot insert parallel split inside a terminal branch")
- Keyboard shortcut: `N` key opens picker for selected node

**E2E Tests** (`test/e2e/tests/interactive/workflow-task-insertion.spec.ts`):
- Verify clicking edge "+" opens task picker (not hardcoded agent_call)
- Verify selecting a task type from picker inserts the correct node
- Verify node output "+" appends a new node after
- Verify switch case "Add case" creates a new branch
- Verify fork "Add parallel branch" creates a new parallel path
- Verify search filtering works in the task picker
- Verify keyboard shortcut `N` opens the picker

---

### T09: Branch Management UX

**Goal**: Build dedicated UX for managing branches in Switch Case, Fork, and TryCatch nodes.

**Deliverables**:
- Switch Case: branch handles with inline labels, reorderable by drag handle, default case marking, "Add case" inline button, branch condition builder in inspector
- Fork: parallel branch listing, join policy selector (wait for all, first success, N of M), "Add branch" button
- TryCatch: protected region, retry policy, catch handler listing with error type filters, "Add catch handler"
- For Each: collection expression, concurrency limit, failure policy (fail fast, continue, retry item)
- Branch port rendering: labeled output handles with stable order

**E2E Tests** (`test/e2e/tests/interactive/workflow-branch-management.spec.ts`):
- Verify switch case branch labels render on the node
- Verify adding a new case creates a labeled output handle
- Verify branch conditions can be configured in the inspector
- Verify fork join policy can be changed

---

### T10: Inspector Panel Refactor

**Goal**: Refactor the inspector to be single-purpose: configure the selected thing. Separate task configuration from task creation and node actions.

**Deliverables**:
- Empty state: workflow-level settings, validation issues, env vars, recent executions
- Node selected: typed config form with tabs (Configure, I/O, Runtime, Advanced, Docs)
- Edge selected: edge/branch configuration
- Execution mode: runtime details for selected node/edge
- Node actions in compact header dropdown: Rename, Duplicate, Disable/Bypass, Delete, Wrap in TryCatch, Extract to subworkflow, View YAML
- Schema-driven per-kind inspector forms:
  - Agent Call: agent, prompt template, model, tools, timeout, budget, streaming, output schema, retry
  - Switch Case: expression language, case table, default behavior, test input, evaluation preview
  - HTTP Call: method, URL, auth, headers, query, body, response transform, timeout, retry
  - Human Input: approvers, channel, prompt, required fields, timeout, escalation, default on timeout
  - And all other task types with appropriate fields

**E2E Tests** (`test/e2e/tests/functional/workflow-inspector.spec.ts`):
- Verify empty state shows workflow summary when nothing selected
- Verify selecting a node shows its configuration form
- Verify agent call inspector shows model and prompt fields
- Verify switch case inspector shows branch condition table
- Verify node actions menu (duplicate, delete, etc.) works from inspector
- Verify deselecting returns to workflow summary

---

### T11: Context Menu and Keyboard Shortcuts

**Goal**: Add right-click context menus and comprehensive keyboard shortcuts.

**Deliverables**:
- Node context menu: Delete, Duplicate, Copy, Disable/Bypass, Add task after, Wrap in TryCatch, View YAML
- Edge context menu: Delete connection, Insert task, Label
- Canvas context menu: Add node, Paste, Select all, Auto-layout, Zoom controls
- Keyboard shortcuts: Delete/Backspace (delete), Ctrl+D (duplicate), Ctrl+C/V (copy/paste), N (add node), Ctrl+Z/Y (undo/redo), arrow keys (nudge)
- `NodeToolbar` floating action bar on selected nodes

**E2E Tests** (`test/e2e/tests/functional/workflow-context-menu.spec.ts`):
- Verify right-click on node opens context menu
- Verify "Delete" from context menu removes the node
- Verify "Duplicate" creates a copy of the node
- Verify Delete key removes selected node
- Verify Ctrl+Z undoes the last action

---

## Phase 3: Overview and Monitoring (Week 4)

### T12: Overview Page Redesign

**Goal**: Replace the tiny thumbnail task-flow diagram with a full-width, interactive, read-only graph using the same renderer as the editor/execution views.

**Deliverables**:
- Full-width read-only graph using `WorkflowGraph` in overview mode
- Click-to-inspect nodes: summary popover with key configuration
- Zoom-to-fit, pan, zoom controls
- Recent execution status badges on nodes (if execution data available)
- Summary cards: budget, environment, success rate, recent failures, mean duration
- "Open in editor" and "View latest run" quick links
- Collapsible tree or lane list as alternative for very dense graphs on narrow screens

**E2E Tests** (`test/e2e/tests/functional/workflow-overview.spec.ts`):
- Verify overview page renders a full-width interactive graph (not a thumbnail)
- Verify clicking a task node shows a summary popover
- Verify zoom controls (zoom in, zoom out, fit-to-view) work
- Verify "Open in editor" link navigates to the editor
- Verify summary cards display budget and env var count

---

### T13: Execution History and Operations Dashboard

**Goal**: Build a richer execution history table with filters, and add workflow-level health metrics.

**Deliverables**:
- Execution table with columns: Run ID, Status, Started, Duration, Cost, Tokens, Version, Trigger, Failed/Current Node, Retries, Human Wait
- Filters: status, workflow version, environment, trigger type, start time, duration range, cost range, failed node, contains retry
- Workflow health strip: success rate, failure rate, p50/p95 duration, p50/p95 cost, token usage, retry count, top failing nodes, top expensive nodes
- Recent failure panel grouped by failing task kind/name
- Run comparison: side-by-side view of failed vs. successful run

**E2E Tests** (`test/e2e/tests/functional/workflow-execution-history.spec.ts`):
- Verify execution history table renders with correct columns
- Verify status filter works (filter to failed runs only)
- Verify clicking a run navigates to the execution graph view
- Verify health metrics display on the workflow page

---

## Phase 4: Polish and Differentiators (Week 5-6)

### T14: AI-Assisted Workflow Creation

**Goal**: Implement AI workflow generation that produces reviewable graph/YAML diffs via the command pattern.

**Deliverables**:
- "Describe a workflow" creation entry point
- AI generates `GraphCommand[]` (not raw graph mutations)
- User sees: graph diff, YAML diff, validation result
- Apply/reject controls
- AI modes: generate new workflow, add next step, fix validation errors, explain workflow, debug failed execution
- Generated workflows open in editor with validation chips and placeholder variables

**E2E Tests** (`test/e2e/tests/interactive/workflow-ai-creation.spec.ts`):
- Verify "Describe workflow" opens AI creation interface
- Verify generated workflow renders in the visual editor
- Verify validation issues are highlighted on generated workflows

---

### T15: Template Gallery

**Goal**: Seed a first-party template gallery focused on AI-agent orchestration patterns.

**Deliverables**:
- Template metadata: name, use case, task count, estimated runtime, estimated cost, required secrets, models used, human approval required
- Initial templates: webhook→agent→approval→callback, multi-agent research pipeline, RAG ingestion, batch enrichment with foreach, support ticket triage, sales lead enrichment, compliance review with human gate, LLM evaluation pipeline, retry/catch notification, scheduled executive report
- Import/customize flow: select template → preview graph → customize → deploy

**E2E Tests** (`test/e2e/tests/functional/workflow-templates.spec.ts`):
- Verify template gallery renders with template cards
- Verify clicking a template shows preview
- Verify "Use template" creates a new workflow from the template

---

### T16: Accessibility and Visual Polish

**Goal**: Ensure WCAG compliance and visual polish across all workflow surfaces.

**Deliverables**:
- ARIA labels on all nodes: "Switch Case node classify_user, 3 branches"
- Keyboard navigation: Tab through nodes, Enter to select, Delete to remove, arrow keys to nudge
- Focus rings visible
- Reduced-motion support for execution animations
- High-contrast theme test
- Color-blind palette test (3:1 contrast for non-text indicators)
- Status badges with text labels (not color-only)

**E2E Tests** (`test/e2e/tests/functional/workflow-accessibility.spec.ts`):
- Verify nodes have ARIA labels
- Verify keyboard navigation works (Tab → Enter → Delete)
- Verify focus rings are visible
- Verify status indicators are not color-only (have text/icon)

---

## Testing Strategy

### Test Infrastructure

All E2E tests use the existing Playwright infrastructure at `test/e2e/`:
- **Config**: `test/e2e/playwright.config.ts`
- **Fixtures**: `test/e2e/fixtures/` (server-manager, seed-helpers, index)
- **Helpers**: `test/e2e/helpers/` (extend existing `workflow-detail.ts`, `workflow-execution.ts`)
- **Global setup/teardown**: `test/e2e/global-setup.ts`, `test/e2e/global-teardown.ts`

### Test Categories

| Category | Location | What it tests |
|----------|----------|---------------|
| **Smoke** | `test/e2e/tests/smoke/` | Basic rendering, page loads, critical paths |
| **Functional** | `test/e2e/tests/functional/` | Feature behavior without backend interactions |
| **Interactive** | `test/e2e/tests/interactive/` | Full user flows with backend (execution, creation, editing) |

### New Test Files (16 total)

| Phase | Test File | Tasks Covered |
|-------|-----------|---------------|
| P0 | `workflow-node-shapes.spec.ts` | T01 |
| P0 | `workflow-node-rendering.spec.ts` | T02 |
| P0 | `workflow-layout.spec.ts` | T03 |
| P1 | `workflow-execution-graph.spec.ts` | T04 |
| P1 | `workflow-execution-inspector.spec.ts` | T05 |
| P1 | `workflow-execution-branches.spec.ts` | T06 |
| P1 | `workflow-execution-timeline.spec.ts` | T07 |
| P2 | `workflow-task-insertion.spec.ts` | T08 |
| P2 | `workflow-branch-management.spec.ts` | T09 |
| P2 | `workflow-inspector.spec.ts` | T10 |
| P2 | `workflow-context-menu.spec.ts` | T11 |
| P3 | `workflow-overview.spec.ts` | T12 |
| P3 | `workflow-execution-history.spec.ts` | T13 |
| P4 | `workflow-ai-creation.spec.ts` | T14 |
| P4 | `workflow-templates.spec.ts` | T15 |
| P4 | `workflow-accessibility.spec.ts` | T16 |

### Test Fixtures Needed

- Workflow YAML fixtures: linear 10-node, switch with 5 branches, fork with 4 branches, foreach, try/catch, 50-node mixed
- Execution event fixtures: successful run, failed run, running with streaming, retries, branch decisions
- Seeded workflows in test database for functional/interactive tests

### Integration with Existing Tests

Existing workflow E2E tests to extend:
- `test/e2e/tests/interactive/workflow-run-flow.spec.ts` — extend with graph-based execution verification
- `test/e2e/tests/interactive/workflow-execution-flow.spec.ts` — extend with runtime inspector assertions
- `test/e2e/tests/interactive/workflow-editor-refine.spec.ts` — extend with new node shape verification
- `test/e2e/tests/functional/workflow-detail.spec.ts` — extend with overview graph assertions
- `test/e2e/tests/functional/workflow-list.spec.ts` — extend with health metrics assertions

---

## Keep / Rewrite / Avoid Summary

### Keep
- `@xyflow/react` v12
- `GraphCommand` history pattern (extend with `layoutPolicy`)
- YAML DSL
- Temporal runtime
- React/Next.js/Tailwind/`--stgm-*` design tokens
- Existing broad task categories
- `TaskPickerPopover` concept (rewrite internals)
- gRPC execution event streaming (existing backend)

### Rewrite
- `CanvasTaskNode` → `WorkflowNode` + `NodeShell` with shape registry
- `CanvasTransitionEdge` → semantic edge renderer with status overlays
- `WorkflowTopologyGraph` → unified `WorkflowGraph` component in overview mode
- `WorkflowExecutionTimeline` → execution cockpit (graph + timeline + inspector)
- `WorkflowExecutionTaskPanel` → runtime inspector panel
- dagre-only layout → ELK pipeline with dagre fallback
- Plus button insertion → contextual task picker with three add modes
- `WorkflowInspectorPanel` → single-purpose, schema-driven, per-kind inspector

### Avoid for now
- Full BPMN compliance
- Custom Canvas/WebGL renderer
- Collaborative CRDT editing
- Overly animated execution graph
- Marketplace before core templates
- CRDTs for multi-user editing

---

## Dependencies Between Tasks

```
T01 (Task Registry) ─────┬──▶ T02 (NodeShell) ──▶ T04 (Execution Canvas) ──▶ T05 (Runtime Inspector)
                          │                                                  ──▶ T06 (Branch Highlighting)
                          │                                                  ──▶ T07 (Waterfall Timeline)
                          │
                          ├──▶ T08 (Task Picker)
                          ├──▶ T09 (Branch Management)
                          ├──▶ T10 (Inspector Refactor)
                          │
T03 (ELK Layout) ────────┤
                          │
T04 + T02 ────────────────┴──▶ T12 (Overview Redesign)
T04 + T05 ─────────────────▶ T13 (Execution History)
T08 + T10 ─────────────────▶ T14 (AI Creation)
T12 ───────────────────────▶ T15 (Template Gallery)
T02 + T04 ─────────────────▶ T16 (Accessibility)
```

**Critical path**: T01 → T02 → T04 → T05/T06/T07

**Parallelizable**: T03 can run in parallel with T01/T02. T11 can run in parallel with T08-T10.
