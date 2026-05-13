# Checkpoint: T15 Batch 3 — Inspector + Edit Loop

**Date**: 2026-05-13
**Task**: T15 Batch 3 — Inspector Panel + Schema-Driven Forms + Mode Toggle
**Status**: COMPLETE
**Scope**: React SDK (`@stigmer/react`) — 2 new files, 4 modified

## Accomplishments

Completed the full visual editing loop: selecting a task node on the canvas opens
a schema-driven inspector panel with configurable fields; a mode toggle on
WorkflowEditorView switches between YAML and Canvas editing; save and validation
work from both modes. The visual builder is now fully functional for authoring
workflows end-to-end.

## New Files (2)

### `sdk/react/src/workflow/TaskConfigForm.tsx`
- Schema-driven form generated from `TaskKindDescriptor.fields` and `fieldGroups`
- Field type -> control mapping: string (text/textarea), int32/float (number),
  bool (toggle), enum (select), struct/message (JSON textarea), repeated (list
  with add/remove), map (key-value pairs with add/remove)
- Collapsible field group sections with chevron toggle
- Required field indicators, `isExpression` badge, `defaultValue` pre-population
- Multiline detection for prompt/expression/body/template fields
- MAX_RECURSION_DEPTH = 2 for nested message types (fallback to JSON editor)
- All styles via `--stgm-*` tokens

### `sdk/react/src/workflow/WorkflowInspectorPanel.tsx`
- Right sidebar with context-sensitive sections based on selection type
- Node inspector: Identity (editable name with validation), Configuration
  (TaskConfigForm), Export (export.as input), Flow (transition target dropdown)
- Edge inspector: source/target display, label, port handle, delete button
- Sentinel inspector: read-only summary for __start__/__end__ nodes
- Task name validation: required, alphanumeric/underscore, uniqueness check
- Controlled component pattern (AD-T15-B3-004): receives selection + graph,
  calls mutation methods — does not own graph state

## Modified Files (4)

### `sdk/react/src/workflow/graph-commands.ts` — 3 new command classes
- `UpdateNodeFieldCommand`: Updates a single field path in node config with
  dot-path support for nested fields. Stores old value for precise undo.
- `RenameNodeCommand`: Changes taskName/id on a node, updates all edge
  source/target references and flow.then references atomically.
- `UpdateNodeMetaCommand`: Updates export.as or flow.then (non-config mutations).
- Helper utilities: `getNestedValue`, `setNestedValue`, `deleteNestedValue`

### `sdk/react/src/workflow/useWorkflowCanvas.ts` — Extended with mutation methods
- `updateNodeField(nodeId, fieldPath, value)` — dispatches UpdateNodeFieldCommand
- `renameNode(nodeId, newName)` — dispatches RenameNodeCommand, updates selection
- `updateNodeExport(nodeId, exportAs)` — dispatches UpdateNodeMetaCommand
- `updateNodeFlow(nodeId, thenTarget)` — dispatches UpdateNodeMetaCommand
- `getNodeDescriptor(nodeId)` — looks up TaskKindDescriptor via registry
- `serializeToYaml()` — serializes current graph to YAML string
- Added `useTaskKindRegistry` integration for descriptor lookups

### `sdk/react/src/workflow/WorkflowEditorView.tsx` — Mode toggle + visual mode
- Added `mode` state: "code" (default) | "visual"
- Segmented control in toolbar for mode switching (Code / Visual tabs)
- Code -> Visual: parses YAML via yamlToGraph(), shows warning dialog about
  lossy normalization, renders WorkflowCanvasEditor on confirm
- Visual -> Code: prompts if canvas has unsaved changes (discard/stay)
- Canvas save: serializes graph to YAML, feeds to existing save pipeline
  (AD-T15-B3-002)
- Validation error mapping: extracts task names from diagnostics, passes
  nodeErrors map to canvas for badge rendering
- Warning dialog and dirty prompt as inline banners (not modal)

### `sdk/react/src/workflow/WorkflowCanvasEditor.tsx` — Inspector + save wiring
- Added WorkflowInspectorPanel as right sidebar (280px, collapsible)
- Added `showInspector` prop (default true)
- Added `onSave` callback prop for toolbar save button
- Added `isSaving` and `nodeErrors` props
- Canvas toolbar: added save button with dirty/saving states
- Wired inspector callbacks to useWorkflowCanvas mutation methods
- Edge deletion via inspector's delete button

## Architectural Decisions

- **AD-T15-B3-001**: Granular update commands. Inspector edits go through
  dedicated GraphCommand subclasses for precise undo/redo (field-level, not
  full-node snapshots).
- **AD-T15-B3-002**: Save via YAML. Canvas save serializes graphToYaml() then
  feeds YAML to existing useWorkflowSave pipeline. Guarantees both modes see
  identical persisted content.
- **AD-T15-B3-003**: Mode state lives in WorkflowEditorView. Internal state,
  not lifted to page. Both modes share the same YAML string as sync medium.
- **AD-T15-B3-004**: Inspector as controlled sidebar. Receives selection +
  graph from canvas hook, calls mutation methods — does not own graph state.

## Verification

- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files

## Next

- **T15 Batch 4**: Specialized Task Editors — BranchConditionBuilder (switch_case),
  ApprovalFormBuilder (human_input)
- **T15 Batch 5**: Integration + Polish — Console wiring (web + desktop),
  barrel exports, a11y, final verification
