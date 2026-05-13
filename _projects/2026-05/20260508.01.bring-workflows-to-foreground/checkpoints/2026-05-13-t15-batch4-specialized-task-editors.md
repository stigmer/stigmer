# Checkpoint: T15 Batch 4 — Specialized Task Editors

**Date**: 2026-05-13
**Task**: T15 Batch 4 — BranchConditionBuilder + ApprovalFormBuilder
**Status**: COMPLETE
**Scope**: React SDK (`@stigmer/react`) — 2 new files, 6 modified

## Accomplishments

Built specialized visual editors for the two most structurally complex task
kinds (`switch_case` and `human_input`), replacing the generic schema-driven
form with purpose-built UIs. Refactored handle IDs from index-based to
name-based for reorder safety, added edge-config bidirectional sync methods,
and fixed a human_input outcome serialization gap.

## New Files (2)

### `sdk/react/src/workflow/BranchConditionBuilder.tsx`
- Specialized inspector editor for `switch_case` nodes
- Ordered case list: name (validated), condition expression (`when`), target task
- Up/down arrow reorder, add/remove with minimum-1 enforcement
- Default case indicator (last case without `when` condition)
- Reads routing from graph edges (edges-as-truth for routing)

### `sdk/react/src/workflow/ApprovalFormBuilder.tsx`
- Specialized inspector editor for `human_input` nodes
- 6 collapsible sections: Prompt, Outcomes, Form Fields, Timeout, Approvers,
  Notification Channels
- Outcomes: name/label/routing with same pattern as BranchConditionBuilder
- Form Fields: visual JSON Schema builder (name, type, required, description,
  enum values) with Raw JSON Schema toggle
- Timeout: duration + unit selector + policy dropdown (Fail/Approve/Deny/Escalate)
- Approvers and Notification Channels: string list editors with format hints

## Modified Files (6)

### `sdk/react/src/workflow/CanvasTaskNode.tsx`
- Name-based handle IDs: `case_{name}` and `outcome_{name}` (was `case_{idx}`)
- Handle label pills positioned below each multi-output port

### `sdk/react/src/workflow/workflow-graph-conversions.ts`
- `yamlToGraph()`: name-based handle IDs on edges for both switch_case and human_input
- `reconstructSwitchCaseThen()`: name-based lookup (was index-based)
- New `reconstructHumanInputOutcomeThen()` — gap fix for outcome routing round-trip

### `sdk/react/src/workflow/graph-commands.ts`
- New `MigrateBranchHandleCommand`: atomic handle ID migration for case/outcome rename

### `sdk/react/src/workflow/useWorkflowCanvas.ts`
- `updateBranchRouting()`: create/update/remove edge for a specific branch handle
- `migrateBranchHandle()`: rename edge sourceHandle when case/outcome is renamed
- `removeBranchEdges()`: remove all edges from a specific handle

### `sdk/react/src/workflow/WorkflowInspectorPanel.tsx`
- Task-kind dispatch: routes switch_case to BranchConditionBuilder, human_input
  to ApprovalFormBuilder, all others to generic TaskConfigForm
- New props: onUpdateBranchRouting, onMigrateBranchHandle, onRemoveBranchEdges
- Hides Flow section for branching tasks (routing managed by builders)

### `sdk/react/src/workflow/WorkflowCanvasEditor.tsx`
- Wires new branch routing props to the inspector panel

## Architectural Decisions

- **AD-T15-B4-001**: Name-based handle IDs (`case_{name}`, `outcome_{name}`)
  instead of index-based. Makes reorder safe without edge remapping.
- **AD-T15-B4-002**: Edges as routing source of truth. Config stores structure
  (name, condition); edges store routing. `graphToYaml()` reconstructs `then`
  fields at serialization time.
- **AD-T15-B4-003**: Gap fix — `reconstructHumanInputOutcomeThen()` mirrors
  `reconstructSwitchCaseThen()` to prevent outcome routing loss during round-trip.

## Verification

- `tsc --noEmit` — clean: sdk/react, sdk/typescript, client-apps/web, client-apps/desktop
- Zero linter errors on all new/modified files

## Next

- **T15 Batch 5**: Integration + Polish — Console wiring (web + desktop),
  barrel exports, a11y, final verification
