# T15 Batch 4: Specialized Task Editors for switch_case and human_input

**Date**: May 13, 2026

## Summary

Added purpose-built visual editors for the two most structurally complex workflow task kinds — `switch_case` (conditional branching) and `human_input` (approval gates). These replace the generic schema-driven form with UIs that make multi-branch routing, condition editing, form schema building, and timeout configuration directly manipulable through the canvas inspector. Also refactored handle IDs from fragile index-based to stable name-based identifiers and fixed a human_input outcome serialization gap.

## Problem Statement

Batches 1-3 of T15 delivered a working visual canvas editor with a generic `TaskConfigForm` that renders any task kind via `TaskKindDescriptor.fields`. While functional, this generic approach falls short for two task kinds with rich internal structure:

### Pain Points

- `switch_case` has an ordered list of conditional branches, each with a name, condition expression, and target task — rendering these as a flat `repeated` list of JSON objects hides the branching semantics
- `human_input` has outcomes (with routing), a form schema (JSON Schema), timeout policies, approver lists, and notification channels — all of which benefit from specialized controls rather than raw JSON editing
- Index-based handle IDs (`case_0`, `case_1`) made reorder operations dangerous because every connected edge's `sourceHandle` needed atomic remapping
- `graphToYaml()` had `reconstructSwitchCaseThen()` to rebuild case routing from edges, but no equivalent for human_input outcomes — causing routing loss during YAML round-trip

## Solution

Two new specialized editor components that replace `TaskConfigForm` when a `switch_case` or `human_input` node is selected, plus infrastructure changes for stable handle IDs and edge-config synchronization.

## Implementation Details

### Handle ID Refactor (Index to Name-Based)

Changed `CanvasTaskNode` from `case_{index}` / `outcome_{index}` to `case_{name}` / `outcome_{name}`. Since `SwitchCase.name` and `HumanInputOutcome.name` are required and unique per the proto definitions, names are stable across reorder operations. Updated `yamlToGraph()`, `reconstructSwitchCaseThen()`, and added `reconstructHumanInputOutcomeThen()` to match.

### BranchConditionBuilder (switch_case)

Ordered case list with:
- Editable name with uniqueness validation
- Condition expression textarea (`${ }` syntax)
- Target task dropdown (reads routing from graph edges)
- Up/down arrow reorder buttons
- Add/remove with minimum-1 enforcement
- Default case indicator (last case without `when`)

### ApprovalFormBuilder (human_input)

Six collapsible sections:
- **Prompt**: Expression-capable textarea
- **Outcomes**: Name/label/routing list (same pattern as cases)
- **Form Fields**: Visual JSON Schema builder with Raw JSON toggle
- **Timeout**: Duration + unit selector + policy dropdown
- **Approvers**: String list with format hints
- **Notification Channels**: String list with format hints

### Edge-Config Sync Architecture

Three new methods on `useWorkflowCanvas`: `updateBranchRouting`, `migrateBranchHandle`, `removeBranchEdges`. Edges are the source of truth for routing; config stores structure (name, condition). `graphToYaml()` reconstructs `then` fields at serialization time.

## Benefits

- Users can visually construct and edit conditional branches without manual JSON editing
- Approval gates are fully configurable through purpose-built controls: form schema builder, timeout policies, approver lists
- Reordering cases/outcomes no longer risks breaking edge connections
- Human_input outcome routing survives YAML round-trip (gap fix)

## Impact

- **SDK React**: 2 new files, 6 modified (~900 lines added)
- **Phase 2 Visual Builder**: Batch 4 of 5 complete. Only integration + polish (Batch 5) remains.
- **Platform builders**: New components (`BranchConditionBuilder`, `ApprovalFormBuilder`) available for embedding

## Related Work

- T15 Batch 1: Canvas Foundation
- T15 Batch 2: Node Authoring
- T15 Batch 3: Inspector + Edit Loop
- T15 Batch 5 (next): Integration + Polish

---

**Status**: ✅ Production Ready
**Timeline**: Single session
