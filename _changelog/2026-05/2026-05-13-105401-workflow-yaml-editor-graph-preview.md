# Workflow YAML Editor with Live Topology Graph Preview (T10)

**Date**: May 13, 2026

## Summary

Built a schema-aware YAML editor with live DAG topology preview for workflow authoring — the first full-document editor in Stigmer's web experience. Users can now view, edit, validate, and save workflow YAML with syntax highlighting, inline diagnostics, and a real-time graph that visualizes the task flow as they type. This is a foundational piece of making workflows a first-class, visible product surface.

## Problem Statement

Workflows existed as invisible backend plumbing with no authoring experience. Users had to write YAML externally, import it, and debug issues through server-side error messages. There was no way to:

### Pain Points

- Edit workflow YAML directly in the console with syntax-aware tooling
- See validation errors inline while editing (structural, schema, reference)
- Visualize the workflow's task flow as a graph while authoring
- Save changes to the server from the editor (round-trip editing)
- Export workflow YAML for the Workflow resource type (only Agent and McpServer were supported)

## Solution

Implemented the full YAML editor experience as an SDK-first feature following the established layered architecture (DD-001, DD-003): YAML serializer/parser, CodeMirror 6 editor with theme bridge, client-side validation pipeline using the TaskKindRegistry, dagre-based topology graph renderer, and a composed editor view integrated as a tab on the workflow detail page.

## Implementation Details

**9 new files** in `sdk/react/src/workflow/`, **6 modified files** across SDK and web console.

### Layer 0: YAML Round-Trip (`serialize-workflow-yaml.ts`)
- `serializeWorkflowYaml()` converts Workflow proto to canonical snake_case YAML
- `parseWorkflowYaml()` converts YAML back to `WorkflowInput` for the apply RPC
- Full enum mapping for 19 task kinds and 3 budget policies
- Extended `useExportResource` to support `kind: "Workflow"` (previously only Agent/McpServer)

### Layer 1-2: Data + Behavior Hooks
- `useWorkflowYaml` — fetches workflow, returns memoized YAML
- `useWorkflowSave` — calls `workflow.apply()`, handles UNIMPLEMENTED gracefully
- `useWorkflowValidation` — 150ms-debounced 5-layer pipeline producing source-mapped CodeMirror diagnostics
- `useWorkflowTopology` — parses YAML into categorized DAG nodes + edges
- `useWorkflowEditor` — orchestrator composing all above

### Layer 3: Styled Components
- `WorkflowYamlEditor` — CodeMirror 6 with `--stgm-*` theme bridge, external diagnostic sync
- `WorkflowTopologyGraph` — SVG renderer with dagre layout, category-colored nodes, zoom/pan
- `WorkflowEditorView` — side-by-side (60/40 split) with toolbar, validation summary, save, full-page toggle

### Layer 4: Console Integration
- "Editor" tab on `WorkflowDetailPage` via `additionalTabs` with toast feedback

### Key Decisions
- **CodeMirror 6** over Monaco: MIT, ~80KB vs ~5MB, no Web Workers, embeddable (DD-004/DD-012/DD-013)
- **Dagre** over React Flow: read-only preview needs ~40KB, not ~200KB interactive editor. React Flow deferred to T15 (Visual Canvas Editor)
- **Client-side validation**: Uses TaskKindRegistry JSON schemas (T04) for instant feedback

## Benefits

- **Workflow authoring in the console** — no external tools needed for editing
- **Instant validation feedback** — syntax, structural, kind, and reference errors shown inline as you type
- **Visual topology preview** — see the DAG update in real-time while editing
- **SDK-embeddable** — all components available to platform builders via `@stigmer/react`
- **Export parity** — Workflow YAML export now matches Agent and McpServer

## Impact

- **Direct users**: Can now author and edit workflows entirely within the web console
- **Platform builders**: Can embed `WorkflowEditorView`, `WorkflowYamlEditor`, or individual hooks in their own products
- **Phase 1 progress**: T10 completes the 4th task in Phase 1 (Foreground MVP), alongside T08, T09, T13

## Related Work

- T04 (Task Schema Registry) — provides the JSON schemas consumed by the validation pipeline
- T08 (Workflow List & Detail Pages) — provides the `WorkflowDetailView` that hosts the Editor tab
- T09 (Execution Viewer) — established the streaming/behavior hook patterns reused here
- T15 (Visual Canvas Editor) — future task that will build on `useWorkflowTopology` with React Flow for interactive editing

---

**Status**: ✅ Production Ready
**Timeline**: Single session
