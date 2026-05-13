# Task T15: Visual Canvas Editor

**Created**: 2026-05-13
**Status**: PENDING REVIEW
**Type**: Feature Development (Batched)
**Depends On**: T10 (YAML Editor with Graph Preview) — COMPLETE, T04 (Task Schema Registry) — COMPLETE
**Phase**: Phase 2 — Visual Builder

## Objective

Build a full visual workflow canvas editor using React Flow, allowing users to construct, edit, and visualize workflow DAGs through drag-and-drop interactions, with YAML round-trip, schema-driven task configuration forms, and specialized editors for complex task kinds (`switch_case`, `human_input`).

## Context

T10 delivered a YAML editor with a read-only topology graph preview (dagre + custom SVG). Users can edit workflows in YAML and see the live DAG. T15 adds the inverse: users can build and edit workflows visually on an interactive canvas, and the system produces valid YAML. This completes the hybrid editor experience — visual for overview and construction, YAML for precision.

The existing foundation provides:
- `useWorkflowTopology` — YAML-to-DAG parsing with category classification (reusable logic)
- `serializeWorkflowYaml` / `parseWorkflowYaml` — proto/YAML round-trip serializers
- `useTaskKindRegistry` — task kind metadata with `categories`, `fields`, `fieldGroups`, `configJsonSchema` (T04)
- `WorkflowEditorView` — side-by-side layout with toolbar, save, validation, full-page toggle
- `useWorkflowSave` / `useWorkflowValidation` — existing save and validation infrastructure
- `@dagrejs/dagre` — already a dependency for auto-layout

## Architectural Decisions

### AD-T15-001: React Flow (@xyflow/react)

**Decision**: Adopt React Flow as the canvas library. MIT licensed (DD-012 compliant), 5.8M weekly npm downloads, mature ecosystem.

**Rationale**: T10 chose dagre + custom SVG for the read-only topology preview (DD-T10-002: ~40KB, no interaction needed). T15 needs full interactivity: drag-and-drop, connection drawing, multi-selection, keyboard navigation, minimap, zoom/pan, custom nodes/edges. Building this from scratch on custom SVG would be thousands of lines and inferior to React Flow's mature implementation. The existing dagre topology graph remains untouched for the YAML editor's preview pane.

**Integration**: Optional peer dependency per DD-013. Loaded via `React.lazy` + `Suspense`. Consumers who don't use the canvas editor pay zero bundle cost.

### AD-T15-002: Lossy YAML Round-Trip

**Decision**: The canvas operates on a typed `WorkflowGraphModel`. Round-trip through the canvas normalizes YAML formatting — comments and custom ordering are not preserved.

**Rationale**: Every major visual workflow tool (GitHub Actions visual editor, Temporal UI, n8n, Prefect) uses lossy round-trip. Preserving the YAML AST while allowing graph mutations is extremely complex and fragile. Users who need precise YAML control use the YAML editor. A clear warning dialog on mode switch prevents surprises.

### AD-T15-003: Auto-Layout Only (No Position Persistence)

**Decision**: Dagre computes a fresh layout every time the canvas opens. Node positions are not persisted.

**Rationale**: Avoids proto changes, storage concerns, and position drift. Users can drag nodes during a session for ad-hoc arrangement, but positions reset on reopen. If users request persistent layouts, a metadata field can be added later without architectural changes.

### AD-T15-004: Flat Top-Level Graph (Nested Tasks Deferred)

**Decision**: The canvas editor models the flat `spec.tasks` list. Nested subgraph tasks (`fork.branches[].do`, `for_each.do`, `try_catch.try/catch.do`) are rendered as **opaque group nodes** with a "contains N tasks" indicator, not as expanded sub-canvases.

**Rationale**: `fork`, `for_each`, and `try_catch` contain `repeated WorkflowTask` fields that form recursive subgraphs. Fully expanding these into interactive nested canvases is a significant UX and engineering challenge (nested React Flow instances, nested undo/redo, nested dirty tracking). For T15 MVP, these tasks are:
- Rendered as special group-style nodes showing the task kind icon, name, and branch/iteration count
- Configurable via the inspector panel (the `do` tasks are edited as YAML within a CodeMirror field in the inspector)
- Fully interactive nested canvas editing deferred to a future enhancement

This keeps T15 deliverable while still supporting all 19 task kinds. Users who need to author `fork`/`for_each`/`try_catch` content can use the YAML editor for those specific tasks or edit the inner tasks via the inspector's embedded YAML field.

## Scope

**T15 is SDK React components + hooks only.** All canvas code lives in `@stigmer/react` (DD-001). Console integration (web + desktop page wiring) is part of the final batch. No proto changes. No backend changes.

### What "visual canvas editor" means (the full surface)

1. **Interactive canvas** — React Flow with custom nodes (task kinds), custom edges (transitions), zoom/pan, minimap, background grid
2. **Task palette** — Sidebar listing all 19 task kinds grouped by category, with search/filter and drag-to-create
3. **Connection drawing** — Draw edges between task output/input ports to define transitions, with validation
4. **Inspector panel** — Property sheet for selected node/edge: task name, config form, export, flow control
5. **Schema-driven forms** — Config forms auto-generated from `TaskKindDescriptor.fields` and `fieldGroups`
6. **Mode toggle** — Switch between YAML editor and visual canvas on `WorkflowEditorView`, with round-trip
7. **Branch condition builder** — Specialized editor for `switch_case` tasks with multi-port nodes
8. **Approval form builder** — Specialized editor for `human_input` tasks with outcomes, form fields, timeout
9. **Undo/redo** — Command-pattern history for canvas operations

## Data Architecture

### WorkflowGraphModel (source of truth in canvas mode)

A pure TypeScript data structure (no React dependencies) that represents the workflow as an editable graph. Lives in `sdk/react/src/workflow/workflow-graph-model.ts`.

```
WorkflowGraphModel
├── document: { dsl, namespace, name, version, description }
├── description?: string
├── env?: Record<string, EnvVarDeclaration>
├── budget?: { maxCostMicros, maxTotalTokens, maxDurationSeconds, onExceeded }
├── nodes: WorkflowGraphNode[]
│   ├── id: string (unique, used as React Flow node ID)
│   ├── taskName: string
│   ├── kind: WorkflowTaskKind
│   ├── config: JsonObject (the task_config Struct contents)
│   ├── export?: { as: string }
│   └── position: { x: number, y: number }
└── edges: WorkflowGraphEdge[]
    ├── id: string (unique, used as React Flow edge ID)
    ├── source: string (source node ID)
    ├── target: string (target node ID)
    ├── label?: string (for switch_case branch labels)
    └── sourceHandle?: string (for multi-port nodes: "case_0", "case_1", etc.)
```

### Conversion Pipeline

```
YAML string
  ↓ yamlToGraph()
WorkflowGraphModel
  ↓ toReactFlowElements()    ↓ graphToWorkflowInput()    ↓ graphToYaml()
React Flow nodes/edges       WorkflowInput (for save)     YAML string (for mode switch)
```

- **`yamlToGraph()`** — Extends logic from `computeTopology()` + `parseWorkflowYaml()`. Parses YAML, extracts full task config/export/flow data, infers edges from sequential ordering + explicit `flow.then` + `switch_case` branches + `human_input` outcome routing.
- **`graphToYaml()`** — Topological sort determines task order. Sequential transitions (task N → task N+1) become implicit. Non-sequential transitions emit explicit `flow.then`. Switch_case edges become `cases[].then` entries. Uses `yaml` package `stringify()`.
- **`graphToWorkflowInput()`** — Converts to the `WorkflowInput` type used by `useWorkflowSave`, reusing enum mapping from `serialize-workflow-yaml.ts`.
- **`toReactFlowElements()`** — Maps `WorkflowGraphNode[]` to React Flow `Node[]` with custom node type + data, and `WorkflowGraphEdge[]` to React Flow `Edge[]` with custom edge type.

### Undo/Redo

Command-pattern history stack on the `WorkflowGraphModel`. Each user action (add node, delete node, move node, add edge, delete edge, edit config) produces a `GraphCommand` with `execute()` and `undo()`. The stack enables Ctrl+Z / Ctrl+Shift+Z.

## Existing Code Reuse

| Existing Code | Reuse in T15 |
|---|---|
| `useWorkflowTopology` — YAML → `{ nodes, edges }` with category classification | `yamlToGraph()` extends this with full config/export/flow data |
| `serialize-workflow-yaml.ts` — enum maps, `structToPlain()`, `parseWorkflowYaml()` | `graphToWorkflowInput()` and `graphToYaml()` reuse the enum string ↔ proto maps and struct utilities |
| `useTaskKindRegistry` — `categories` map, `getByKind()`, `getJsonSchema()` | Task palette uses `categories` directly; inspector uses `fields`/`fieldGroups` for form generation |
| `useWorkflowSave` — save logic with `stigmer.workflow.apply()` | Canvas editor's save flow delegates to this |
| `useWorkflowValidation` — debounced validation pipeline | Canvas validates by serializing graph → YAML → running existing pipeline |
| `CATEGORY_COLORS` in `WorkflowTopologyGraph.tsx` | Extracted to a shared constant for consistent node coloring across read-only graph and canvas |
| `WorkflowEditorView` — toolbar, full-page toggle, split layout | Extended with mode toggle; canvas becomes an alternative to the YAML editor pane |
| `WorkflowYamlEditor` — CodeMirror 6 component | Reused in inspector panel for `struct`/`message` fields and nested task editing |

## File Plan

All new files in `sdk/react/src/workflow/`:

| File | Type | Batch | Purpose |
|---|---|---|---|
| `workflow-graph-model.ts` | Model | 1 | Graph types + `yamlToGraph()` + `graphToYaml()` + `graphToWorkflowInput()` + undo/redo commands |
| `canvas-constants.ts` | Constants | 1 | Shared constants (category colors, node dimensions, port positions) extracted from `WorkflowTopologyGraph` |
| `CanvasTaskNode.tsx` | Component | 1 | Custom React Flow node: kind icon, name, category border, input/output handles |
| `CanvasTransitionEdge.tsx` | Component | 1 | Custom React Flow edge: directed arrow, optional label pill |
| `WorkflowCanvasEditor.tsx` | Component | 1 | React Flow canvas with controls, minimap, background. React.lazy wrapper. |
| `useWorkflowCanvas.ts` | Hook | 1 | Orchestrator: graph state, React Flow callbacks, auto-layout, undo/redo |
| `WorkflowTaskPalette.tsx` | Component | 2 | Categorized task kind sidebar with search, drag-to-create |
| `WorkflowInspectorPanel.tsx` | Component | 3 | Property sheet for selected node/edge: identity, config, export, flow |
| `TaskConfigForm.tsx` | Component | 3 | Schema-driven form generated from `TaskKindDescriptor.fields`/`fieldGroups` |
| `BranchConditionBuilder.tsx` | Component | 4 | Switch_case: case list, conditions, targets, multi-port node support |
| `ApprovalFormBuilder.tsx` | Component | 4 | Human_input: outcomes, form fields, timeout, approvers |

Modified files:

| File | Batch | Change |
|---|---|---|
| `sdk/react/package.json` | 1 | Add `@xyflow/react` as optional peer dep + dev dep |
| `sdk/react/src/workflow/WorkflowEditorView.tsx` | 3 | Add YAML/Canvas mode toggle in toolbar |
| `sdk/react/src/workflow/index.ts` | 5 | Barrel exports for all new hooks + components |
| `sdk/react/src/index.ts` | 5 | Top-level exports |
| `client-apps/web/src/domain/workflow/WorkflowDetailPage.tsx` | 5 | Install `@xyflow/react` peer dep |
| `client-apps/desktop/src/pages/workflow/WorkflowDetailPage.tsx` | 5 | Install `@xyflow/react` peer dep |
| `client-apps/web/package.json` | 5 | Add `@xyflow/react` dependency |
| `client-apps/desktop/package.json` | 5 | Add `@xyflow/react` dependency |

## Batched Sub-Tasks

T15 is split into five batches, each independently deliverable and verifiable. Each batch can be picked up in a separate session.

---

### Batch 1: Canvas Foundation (T15.1 + T15.2)

> Render an existing workflow as an interactive, styled canvas with draggable nodes.

This batch delivers the core infrastructure: the graph data model, the YAML-to-graph conversion, the React Flow integration, and the visual canvas with custom nodes and edges. After this batch, opening an existing workflow shows a live interactive canvas — the first visual proof of the editor.

#### T15.1: Graph Model + Dependency Setup

**New file**: `workflow-graph-model.ts`

Types:
- `WorkflowGraphModel` — top-level container
- `WorkflowGraphNode` — task node with `id`, `taskName`, `kind`, `config` (JsonObject), `export?`, `position`
- `WorkflowGraphEdge` — edge with `id`, `source`, `target`, `label?`, `sourceHandle?`
- `GraphCommand` — undo/redo command interface (`execute()`, `undo()`, description`)
- `GraphHistory` — command stack with `push()`, `undo()`, `redo()`, `canUndo`, `canRedo`

Conversion functions:
- `yamlToGraph(yaml: string): WorkflowGraphModel` — Parses YAML, builds nodes from `spec.tasks` (all 19 kinds), infers edges from: (1) sequential ordering when no explicit `flow.then`, (2) explicit `flow.then` targets, (3) `switch_case` `cases[].then` with labels, (4) `human_input` `outcomes[].then` routing, (5) `validate`/`agent_call`/`llm_call` `fallback_task` references. Adds synthetic `__start__` and `__end__` nodes.
- `graphToYaml(graph: WorkflowGraphModel): string` — Topological sort for task ordering. For each task: if its sole outgoing edge targets the next task in sorted order, omit `flow.then` (implicit sequential). Otherwise emit explicit `flow.then`. For `switch_case` nodes, reconstruct `cases[].then` from outgoing edges by `sourceHandle`. Produces clean YAML via `yaml` package `stringify()`.
- `graphToWorkflowInput(graph: WorkflowGraphModel, org: string): WorkflowInput` — For the save path. Reuses enum mapping from `serialize-workflow-yaml.ts`.
- `toReactFlowElements(graph: WorkflowGraphModel): { nodes: Node[], edges: Edge[] }` — Maps graph model to React Flow's typed node/edge arrays with custom type identifiers.

**Dependency setup**: Add `@xyflow/react` to `sdk/react/package.json`:
- `peerDependencies`: `"@xyflow/react": "^12.0.0"`
- `peerDependenciesMeta`: `{ "@xyflow/react": { "optional": true } }`
- `devDependencies`: `"@xyflow/react": "^12.10.2"`

**New file**: `canvas-constants.ts`

Extract `CATEGORY_COLORS` from `WorkflowTopologyGraph.tsx` into a shared constant (both the read-only graph and the canvas need them). Add node dimension constants, port position configs, and category icon mappings (lucide icon names from `TaskKindDescriptor.icon`).

#### T15.2: Canvas + Custom Nodes + Custom Edges

**New file**: `CanvasTaskNode.tsx`

Custom React Flow node component. Renders:
- Category-colored left border (4px, matching `CATEGORY_COLORS`)
- Task kind icon (lucide, from `TaskKindDescriptor.icon` via registry)
- Task name (editable inline on double-click)
- Kind badge (small, muted)
- Input handle (top center) and output handle (bottom center)
- For `switch_case`: multiple output handles (one per case, labeled)
- For nested tasks (`fork`, `for_each`, `try_catch`): group indicator showing branch/iteration count
- Selected state: ring highlight
- All styles via `--stgm-*` tokens

**New file**: `CanvasTransitionEdge.tsx`

Custom React Flow edge component. Renders:
- Directed path with arrowhead marker
- Optional label pill (for switch_case branch names, human_input outcome names)
- Selected state: highlighted stroke
- Animated dash pattern for "active" edges (future: execution viewer integration)

**New file**: `useWorkflowCanvas.ts`

Behavior hook that orchestrates the canvas:
- Manages `WorkflowGraphModel` state
- Converts model ↔ React Flow elements via `toReactFlowElements()`
- Wires React Flow callbacks: `onNodesChange` (position drag), `onConnect`, `onEdgesChange`, `onNodeClick`, `onEdgeClick`
- Auto-layout: runs dagre on mount and on explicit "auto-layout" button
- Selected element tracking (for inspector panel in Batch 3)
- Graph history (undo/redo stack from `GraphHistory`)
- Dirty tracking: compares current model against initial snapshot
- `save()`: delegates to `useWorkflowSave` via `graphToWorkflowInput()`

**New file**: `WorkflowCanvasEditor.tsx`

Composed canvas component wrapped in `React.lazy` for DD-013:
- React Flow `<ReactFlow>` with custom node types, custom edge types
- `<Controls>` (zoom in/out, fit view)
- `<MiniMap>` (category-colored node previews)
- `<Background>` (dots grid)
- Toolbar: auto-layout button, undo/redo buttons, zoom controls, save button, dirty indicator
- Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z (redo), Delete/Backspace (delete selected)

**Verification checkpoint**:
- `tsc --noEmit` clean for `sdk/react`
- Opening a workflow YAML renders an interactive canvas with properly styled, draggable nodes and edges
- Auto-layout produces a clean top-to-bottom DAG
- Nodes can be dragged, canvas can be panned/zoomed

---

### Batch 2: Node Authoring (T15.3 + T15.4)

> Create new tasks by dragging from a palette, connect them by drawing edges, delete and rearrange.

This batch turns the canvas from a viewer into an authoring tool. Users can add tasks from a categorized palette, draw transitions between them, and manage the graph structure with deletion and multi-selection.

#### T15.3: Task Palette + Drag-to-Create

**New file**: `WorkflowTaskPalette.tsx`

Sidebar panel (left side of canvas) showing all task kinds:
- Data from `useTaskKindRegistry().categories` — grouped by `TaskKindCategory` (`ai`, `control_flow`, `invocation`, `data`, `governance`, `event`)
- Each category is a collapsible section with header
- Each task kind entry: icon (lucide) + display name + one-line description (from `TaskKindDescriptor`)
- Search/filter input at top — filters across all categories by name and description
- Draggable entries: HTML5 drag with `dataTransfer` carrying the task kind identifier
- Loading/error states for registry fetch

Canvas drop handler in `useWorkflowCanvas`:
- `onDrop` + `onDragOver` on the React Flow container
- Creates new `WorkflowGraphNode` with: auto-generated name (`{kind}_{count}`), empty config, position at drop coordinates (screen → flow coordinate conversion)
- Pushes `AddNodeCommand` to undo/redo history
- New node is auto-selected (triggers inspector in Batch 3)

Start/End sentinel management:
- `__start__` node is always present, not deletable, connects to the first task
- `__end__` node appears when any task has `flow.then: "end"` or is a terminal task
- When the first task is added to an empty canvas, auto-create `__start__` → task edge

#### T15.4: Connection Drawing + Flow Validation

Connection creation:
- React Flow's native connection mode: drag from output handle to input handle
- Connection type: `smoothstep` (90-degree routed edges, standard for DAG editors)
- On connect: creates `WorkflowGraphEdge`, pushes `AddEdgeCommand` to history

Connection validation callback (`isValidConnection`):
- No self-connections (source === target)
- No duplicate edges between same source → target pair
- Non-switch_case nodes: maximum one outgoing edge (warn if replacing existing)
- Reject connections to `__start__` node (it has no input handle)
- Reject connections from `__end__` node (it has no output handle)

Deletion:
- Select node(s) / edge(s) + Backspace or Delete key
- Node deletion cascades: removes all connected edges
- `__start__` and `__end__` nodes are not deletable
- Pushes `DeleteNodeCommand` or `DeleteEdgeCommand` to history

Multi-selection:
- Shift+click to add to selection
- Lasso select (React Flow built-in `selectionMode`)
- Select all: Ctrl+A / Cmd+A
- Delete selection: all selected nodes + edges removed in one command

**Verification checkpoint**:
- `tsc --noEmit` clean for `sdk/react`
- Users can drag task kinds from the palette onto the canvas
- Drawing an edge from one task to another creates a visible connection
- Invalid connections are rejected with visual feedback (red flash)
- Delete key removes selected nodes and their edges
- Undo/redo works for all operations (add node, add edge, delete)

---

### Batch 3: Inspector + Edit Loop (T15.5 + T15.6)

> Configure task properties through schema-driven forms. Switch between YAML and visual editing modes. Save from either mode.

This batch completes the editing loop: select a task on the canvas → see its config in the inspector → edit fields → save. It also adds the mode toggle on `WorkflowEditorView` so users can switch between YAML and canvas editing of the same workflow.

#### T15.5: Inspector Panel + Schema-Driven Forms

**New file**: `WorkflowInspectorPanel.tsx`

Right sidebar panel (slides in when a node or edge is selected, collapses when nothing is selected):
- **For task nodes** — four sections:
  1. **Identity**: Task name (editable text input with uniqueness validation), kind (read-only badge with icon and category color), description (from `TaskKindDescriptor.description`)
  2. **Configuration**: `TaskConfigForm` (see below) — the main editing surface
  3. **Export**: Optional `export.as` expression input with placeholder hint
  4. **Flow**: Transition target — dropdown listing all other task names + "end" + "next (implicit)". Shows current `flow.then` value.
  5. **Advanced** (collapsed by default): Budget override fields (if `isAiNative` on the descriptor)

- **For edges** — simpler panel:
  1. Label (editable, for switch_case branch names)
  2. Source → Target display (read-only)
  3. Delete edge button

- **For `__start__` / `__end__` nodes**: Non-editable summary panel

**New file**: `TaskConfigForm.tsx`

Schema-driven form component generated from `TaskKindDescriptor.fields` and `fieldGroups`:
- Renders field groups as collapsible sections (using `fieldGroups[].displayName`)
- Field type → control mapping:

| `TaskFieldType` | Form Control |
|---|---|
| `string` | Text input. Multiline textarea if field name contains "prompt", "expression", "body", or "template". |
| `int32` / `float` | Number input with min/max from `validationHints` |
| `bool` | Toggle switch |
| `enum` | Select dropdown populated from `enumValues` |
| `struct` | Embedded CodeMirror YAML/JSON editor (reuses `WorkflowYamlEditor` with `readOnly={false}`) |
| `repeated` | List with add/remove buttons. Each item rendered by `elementType`. |
| `map` | Key-value pair list with add/remove. |
| `message` | Nested fieldset (recursive `TaskConfigForm` for the sub-message fields, if descriptor provides them) |

- Required field indicators (asterisk + red border on empty)
- `is_expression` fields: highlighted border, `${ }` placeholder hint
- `defaultValue` pre-populated on new tasks
- Changes call `updateNodeConfig(nodeId, fieldPath, value)` on `useWorkflowCanvas`

#### T15.6: YAML Round-Trip + Mode Switching

Mode toggle on `WorkflowEditorView`:
- New toolbar element: segmented control with "Code" and "Visual" options
- Default mode: "Code" (existing YAML editor behavior, no change)
- "Visual" mode: replaces the YAML editor pane + topology graph with the full canvas editor (palette + canvas + inspector)

YAML → Canvas transition (`onSwitchToVisual`):
- Parse current YAML via `yamlToGraph()`
- If parse fails: show error toast, stay in Code mode
- If parse succeeds: show warning dialog — "Switching to visual mode will normalize YAML formatting. Comments and custom ordering will not be preserved. Continue?"
- On confirm: render `WorkflowCanvasEditor` with the parsed graph model

Canvas → YAML transition (`onSwitchToCode`):
- If canvas is dirty with unsaved changes: show "Save or discard changes?" dialog
- Serialize current graph via `graphToYaml()`
- Load result into YAML editor

Save from canvas:
- `useWorkflowCanvas.save()` → `graphToWorkflowInput()` → `useWorkflowSave.save()`
- On success: update initial snapshot (clears dirty state)
- On error: error banner in canvas toolbar

Validation in canvas mode:
- Serialize graph to YAML → run `useWorkflowValidation` pipeline
- Map validation errors back to graph nodes: if a diagnostic mentions a task name, show a red error badge on that node
- Validation summary in canvas toolbar (same `ValidationSummary` component from `WorkflowEditorView`)

**Verification checkpoint**:
- `tsc --noEmit` clean for `sdk/react`, `sdk/typescript`, `client-apps/web`
- Selecting a task node on the canvas opens the inspector with its full config form
- Editing a field in the inspector updates the graph model
- Mode toggle switches between YAML and Canvas views
- Warning dialog appears on YAML → Canvas switch
- Save works from canvas mode
- Validation errors show as badges on nodes

---

### Batch 4: Specialized Task Editors (T15.7 + T15.8)

> Visual builders for the two most complex task kinds: `switch_case` branching and `human_input` approval gates.

These task kinds have internal structure that goes beyond simple key-value configuration: `switch_case` has an ordered list of conditional branches, and `human_input` has outcomes, form schemas, timeouts, and approver lists. Generic form rendering from Batch 3 handles the basic fields, but these two kinds deserve specialized editors that make their structure visually clear and easy to manipulate.

#### T15.7: Branch Condition Builder (switch_case)

**New file**: `BranchConditionBuilder.tsx`

Specialized inspector section that replaces the generic `TaskConfigForm` when a `switch_case` node is selected:

- **Case list**: Ordered list of `SwitchCase` entries, each showing:
  - Name (editable text input)
  - Condition expression (`when` field — text input with `${ }` hint, empty = default case)
  - Target task (`then` field — dropdown of all task names)
  - Drag handle for reordering
  - Delete button (minimum 1 case enforced)
- **Add case button**: Appends a new case with empty `when` (default) and no `then`
- **Default case indicator**: The last case without a `when` value is visually marked as "Default"

Multi-port node rendering:
- `switch_case` nodes in `CanvasTaskNode` render one output handle per case (labeled with case name)
- When cases are added/removed/reordered in the builder, the node handles update
- Drawing an edge from a specific case handle to a target task sets that case's `then` value
- Deleting a case-specific edge clears the `then` value for that case

Edge ↔ case synchronization:
- Adding an edge from a case handle updates `config.cases[N].then`
- Changing `then` in the builder updates or creates the corresponding edge
- Removing a case removes the corresponding edge

#### T15.8: Approval Form Builder (human_input)

**New file**: `ApprovalFormBuilder.tsx`

Specialized inspector section that replaces the generic `TaskConfigForm` when a `human_input` node is selected. Organized into sub-sections:

**Prompt**: Textarea for the `prompt` field with `${ }` expression hint.

**Outcomes**: List of `HumanInputOutcome` entries:
- Each shows: name (editable), label (editable, placeholder = capitalized name), target task (`then` dropdown, optional)
- Add/remove/reorder outcomes
- When empty: display hint — "No custom outcomes. Default: binary Approve / Deny."
- Like switch_case, each outcome can produce an output handle on the node for visual routing

**Form Fields** (from `form_schema`):
- Visual form field builder — a list of fields:
  - Field name (text input)
  - Field type selector (string, number, boolean, enum — mapped to JSON Schema types)
  - Required toggle
  - Description (optional text input)
  - For enum type: comma-separated values input
- Produces a valid JSON Schema `Struct` for the `form_schema` field
- "Raw JSON Schema" toggle to switch to direct CodeMirror editing for advanced schemas

**Timeout Configuration**:
- Duration input (number + unit selector: seconds, minutes, hours, days)
- Policy selector (`on_timeout`): dropdown with the four `HumanInputTimeoutPolicy` values, showing human-readable labels
- Escalation task selector (shown only when policy = `ESCALATE`)

**Approvers**: String list editor for the `approvers` field with format hints.

**Notification Channels**: String list editor for `notification_channels` with format hints.

**Verification checkpoint**:
- `tsc --noEmit` clean for `sdk/react`
- Switch_case nodes show multiple output handles matching their cases
- Branch condition builder synchronizes with edges on the canvas
- Human_input nodes are fully configurable through the approval form builder
- Form field builder produces valid JSON Schema

---

### Batch 5: Integration + Polish (T15.9)

> Wire the canvas editor into both console apps, export all new APIs, verify everything compiles.

This batch is the final integration pass. No new behavioral features — it ensures the canvas editor works correctly in both web and desktop consoles, all new hooks and components are properly exported, and the full verification suite passes.

#### Console Integration (DD-016)

Web (`client-apps/web`):
- Add `@xyflow/react` to `client-apps/web/package.json`
- Verify `WorkflowEditorView` mode toggle works in the web console's workflow detail page
- No changes to page routing — the mode toggle is internal to `WorkflowEditorView`

Desktop (`client-apps/desktop`):
- Add `@xyflow/react` to `client-apps/desktop/package.json`
- Verify identical behavior (DD-016 parity check)

#### Barrel Exports

Update `sdk/react/src/workflow/index.ts`:
- Export types: `WorkflowGraphModel`, `WorkflowGraphNode`, `WorkflowGraphEdge`
- Export hooks: `useWorkflowCanvas`
- Export components: `WorkflowCanvasEditor`, `WorkflowTaskPalette`, `WorkflowInspectorPanel`, `TaskConfigForm`, `BranchConditionBuilder`, `ApprovalFormBuilder`
- Export conversion functions: `yamlToGraph`, `graphToYaml`, `graphToWorkflowInput`

Update `sdk/react/src/index.ts`:
- Top-level re-exports for the new public surface

#### Keyboard Accessibility

- Focus management: Tab through canvas → palette → inspector
- Arrow key navigation between nodes when canvas is focused
- Screen reader announcements for selection changes (aria-live region)
- All interactive elements keyboard-reachable

#### Final Verification

- `tsc --noEmit` — clean for: `sdk/react`, `sdk/typescript`, `client-apps/web`, `client-apps/desktop`
- `eslint` — zero new errors on all new/modified files
- `make lint` — theme token compliance check (no hardcoded colors, no opacity modifiers)
- Manual check: same workflow renders identically in web and desktop canvas editors

---

## Naming Conventions (Following Existing Patterns)

| Convention | Existing Examples | T15 Follows Same Pattern |
|---|---|---|
| Behavior hooks: `use<Domain><Purpose>` | `useWorkflowEditor`, `useWorkflowTopology`, `useRunWorkflowFlow` | `useWorkflowCanvas` |
| Data hooks: `use<Resource>` | `useWorkflow`, `useWorkflowExecution`, `useTaskKindRegistry` | (reuses existing) |
| Styled components: `<Domain><Purpose>` | `WorkflowEditorView`, `WorkflowTopologyGraph`, `WorkflowDetailView` | `WorkflowCanvasEditor`, `WorkflowTaskPalette`, `WorkflowInspectorPanel` |
| Sub-components: `<Specific>` | `CanvasTaskNode`, `CanvasTransitionEdge` | `TaskConfigForm`, `BranchConditionBuilder`, `ApprovalFormBuilder` |
| Model files: kebab-case `.ts` | `serialize-workflow-yaml.ts` | `workflow-graph-model.ts`, `canvas-constants.ts` |

## Implementation Order

Each batch is independently deliverable. Batches must be executed in order (each depends on the previous).

```
Batch 1 (T15.1 + T15.2) — Canvas Foundation
  → Highest value: first visual proof of the canvas. All infrastructure.
  → Delivers: graph model, React Flow integration, custom nodes/edges, auto-layout.

Batch 2 (T15.3 + T15.4) — Node Authoring
  → Turns canvas from viewer to authoring tool.
  → Delivers: task palette, drag-to-create, connections, deletion, multi-select.

Batch 3 (T15.5 + T15.6) — Inspector + Edit Loop
  → Completes the full editing loop: select → edit → save.
  → Delivers: inspector panel, schema-driven forms, mode toggle, round-trip, validation.

Batch 4 (T15.7 + T15.8) — Specialized Task Editors
  → Polishes the two most complex task kinds with dedicated UIs.
  → Delivers: branch condition builder, approval form builder, multi-port nodes.

Batch 5 (T15.9) — Integration + Polish
  → Ships to production. Web + desktop parity, exports, accessibility, verification.
  → Delivers: console wiring, barrel exports, a11y, final verification.
```

## Per-Batch Deliverables

For each batch, the session should:

1. Create the new files following SDK-first architecture (DD-001)
2. Use `--stgm-*` tokens for all visual properties (DD-005)
3. Ensure zero Console-specific dependencies in SDK code (DD-004)
4. Use generated types from `@stigmer/protos` — never hand-write duplicates (DD-007)
5. Wrap hook returns in `useMemo` for reference stability (DD-010)
6. Use `React.lazy` for `@xyflow/react` imports (DD-013)
7. Run `tsc --noEmit` — zero errors on affected packages
8. Create a checkpoint in `checkpoints/` summarizing what was delivered

## Out of Scope for T15

- **Nested subgraph canvas editing** — `fork.do`, `for_each.do`, `try_catch.try/catch.do` as interactive nested canvases (AD-T15-004 defers this)
- **Node position persistence** — No proto changes for layout metadata (AD-T15-003)
- **Real-time collaboration** — Multi-user canvas editing
- **Execution overlay** — Showing live execution status on canvas nodes (separate feature)
- **Template gallery** — Pre-built workflow templates for quick-start
- **Proto or backend changes** — T15 is purely SDK React layer
- **Natural language to workflow** — T16 (Phase 3)

## Risks

| Risk | Mitigation |
|---|---|
| React Flow bundle size (~200KB) | DD-013: optional peer dep + React.lazy. Zero cost for non-canvas consumers. |
| Graph model complexity (19 task kinds × config shapes) | Model layer is pure TypeScript, testable in isolation. Conversion functions handle each kind explicitly. |
| Inspector form generation for `struct`/`message` fields | Fall back to embedded CodeMirror YAML editor for complex nested structures. |
| switch_case multi-port rendering | React Flow supports custom handles natively. Prototype early in Batch 1 to validate. |
| Lossy round-trip surprises | Clear warning dialog. YAML editor remains available for precise control. |
| Nested task kinds (fork/for_each/try_catch) | Rendered as opaque group nodes. Inner tasks editable via inspector's embedded YAML field. Full nested canvas deferred. |
| Large workflows (100+ tasks) | React Flow handles thousands of nodes. Dagre layout may be slow; evaluate elkjs (web worker) if needed. |

## Suggested Starting Point

Begin with **Batch 1 (T15.1 + T15.2)** — Canvas Foundation — because it delivers the core infrastructure that all other batches build on, and provides the first visual proof that the canvas approach works.

---

**Please review this plan and provide your feedback. I will not proceed to execution until you explicitly approve a batch.**
