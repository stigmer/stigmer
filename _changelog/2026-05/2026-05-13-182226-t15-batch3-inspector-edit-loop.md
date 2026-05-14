# T15 Batch 3: Inspector Panel + Schema-Driven Forms + YAML/Visual Mode Toggle

**Date**: May 13, 2026

## Summary

Completed the full visual editing loop for the workflow canvas editor. Selecting a task node on the canvas opens a schema-driven inspector panel with configurable fields generated from `TaskKindDescriptor` metadata; a mode toggle on `WorkflowEditorView` switches between YAML and Canvas editing with safe round-trip; save and validation work from both modes.

## Problem Statement

After T15 Batches 1 and 2 delivered the interactive canvas (nodes, edges, palette, undo/redo), users could build workflow graph structures visually but had no way to configure task properties, switch between YAML and visual editing, or save from canvas mode.

### Pain Points

- No way to edit task configuration fields (model, prompt, parameters) from the visual canvas
- No round-trip between YAML editor and visual canvas — two disconnected experiences
- No save capability from canvas mode — users would lose visual edits
- No validation feedback in canvas mode — errors only visible in code mode

## Solution

Three-phase delivery within Batch 3:
1. Graph mutation commands for granular field-level undo/redo
2. Inspector panel with schema-driven forms consuming `TaskKindDescriptor` metadata
3. Mode toggle with safe switching, warning dialogs, and YAML-based save pipeline

## Implementation Details

### Phase A: Graph Mutation Commands

Three new `GraphCommand` subclasses in `graph-commands.ts`:
- **`UpdateNodeFieldCommand`**: Dot-path field updates in node config (e.g., `config.model`). Stores old value for precise undo. Supports nested paths with immutable spread at each level.
- **`RenameNodeCommand`**: Atomically renames taskName + id, updates all edge source/target references and flow.then references across the graph. Both apply and undo are symmetric rename operations.
- **`UpdateNodeMetaCommand`**: Updates `export.as` or `flow.then` properties with old-value capture.

Six new mutation methods on `useWorkflowCanvas`: `updateNodeField`, `renameNode`, `updateNodeExport`, `updateNodeFlow`, `getNodeDescriptor`, `serializeToYaml`.

### Phase B: Inspector Panel + Schema-Driven Forms

**`TaskConfigForm.tsx`** — Generates form controls from `TaskKindDescriptor.fields`:

| Field Type | Control |
|---|---|
| `string` | Text input / textarea (for prompt/expression/body fields) |
| `int32` / `float` | Number input |
| `bool` | Checkbox toggle |
| `enum` | Select dropdown from `enumValues` |
| `struct` / `message` | JSON textarea editor (2-level recursion limit) |
| `repeated` | Add/remove list with per-item inputs |
| `map` | Key-value pair editor with add/remove |

Fields grouped by `fieldGroups` as collapsible sections. Required indicators, expression badges, and default value pre-population.

**`WorkflowInspectorPanel.tsx`** — Right sidebar:
- Node inspector: Identity (editable name with uniqueness validation), Configuration (TaskConfigForm), Export, Flow sections
- Edge inspector: source/target display, label, delete button
- Sentinel inspector: read-only summaries for __start__/__end__

### Phase C: Mode Toggle + Save

**`WorkflowEditorView.tsx`** transformed into a dual-mode editor:
- Segmented control: Code | Visual
- Code → Visual: parse YAML via `yamlToGraph()`, show warning about lossy normalization, render canvas on confirm
- Visual → Code: dirty prompt if unsaved changes, serialize via `graphToYaml()`
- Canvas save: serializes graph to YAML, feeds to existing `useWorkflowSave` pipeline (AD-T15-B3-002)
- Validation error mapping: regex-extracts task names from diagnostics, passes error map for node badges

## Benefits

- Complete visual authoring loop: users can now create, configure, and save workflows entirely in the visual canvas
- Schema-driven forms eliminate manual JSON editing for task configuration
- Granular undo/redo for inspector edits (field-level, not full snapshots)
- Mode toggle gives users choice: YAML for precision, visual for overview/construction
- Platform builders get new embeddable components (`WorkflowInspectorPanel`, `TaskConfigForm`) via `@stigmer/react`

## Impact

- **Direct users**: Full visual workflow authoring capability — from invisible infrastructure to a first-class product surface
- **Platform builders**: New SDK components for embedding workflow configuration UIs
- **Architecture**: Establishes the pattern for future specialized editors (Batch 4: switch_case, human_input)

## Related Work

- T15 Batch 1 (canvas foundation): `2026-05-13-172034-t15-batch1-visual-canvas-editor-foundation.md`
- T15 Batch 2 (node authoring): `2026-05-13-174729-t15-batch2-canvas-node-authoring.md`
- T10 (YAML editor): `2026-05-13-105401-workflow-yaml-editor-graph-preview.md`
- T04 (task schema registry): `2026-05-12-154911-task-schema-registry.md`

---

**Status**: Production Ready
**Timeline**: Single session (Phase A + B + C)
