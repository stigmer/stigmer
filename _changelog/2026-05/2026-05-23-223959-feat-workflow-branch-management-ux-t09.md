# Workflow Branch Management UX (T09)

**Date**: May 23, 2026

## Summary

Implemented dedicated branch management UX for all control-flow nodes in the workflow visual editor: Switch Case, Fork, TryCatch, and ForEach. Added 12 new reversible graph commands, 3 inspector tabs, canvas-level branch badges with ARIA accessibility, enhanced switch case handles with default-case marking and overflow condensation, and comprehensive duplicate-name detection in branch popover.

## Problem Statement

Branch-type workflow nodes (switch_case, fork, try_catch, for_each) had minimal management UX. T08 added the ability to *create* branches via popover, but users could not:
- Remove, reorder, or rename branches
- View/edit fork join policies
- Configure catch handler error variables
- Manage for_each concurrency and error policies
- See branch metadata at a glance on the canvas

### Pain Points

- Fork nodes showed only a flat bar with no indication of which branches existed
- TryCatch container gave no visual cue about catch handler presence
- ForEach had no inspector UI for its rich proto config (max_parallelism, batch_size, on_error)
- Switch case handle overflow with many cases caused visual clutter
- Duplicate branch names were not detected when adding via canvas popover

## Solution

Inspector-first branch management with informational canvas badges, preserving the flat graph model (AD-T03-003). Each control-flow node kind gets a dedicated inspector tab with full CRUD operations, while the canvas shows lightweight decorative badges for at-a-glance context.

## Implementation Details

### Graph Commands (12 new, all reversible with undo)

| Command | Purpose |
|---------|---------|
| `RemoveSwitchCaseCommand` | Remove case from config + delete associated edge |
| `ReorderSwitchCasesCommand` | Reorder config.cases array |
| `RemoveForkBranchCommand` | Remove branch (min 2 enforcement) |
| `ReorderForkBranchesCommand` | Reorder config.branches array |
| `RenameForkBranchCommand` | Rename a fork branch |
| `SetForkCompeteCommand` | Toggle compete (race) mode |
| `UpdateCatchConfigCommand` | Update catch.as / catch.compensate |
| `RemoveCatchBlockCommand` | Remove catch block entirely |
| `UpdateForEachConfigCommand` | Update any for_each config field |
| `AddNestedTaskCommand` | Push task into nested do[] array |
| `RemoveNestedTaskCommand` | Remove from nested array by index |
| `ReorderNestedTasksCommand` | Move task within nested array |

### Inspector Tabs (3 new)

- **BranchesTab** — switch_case (case listing, reorder, remove, conditions) + fork (branch listing, join policy, rename, reorder, remove)
- **CatchTab** — try_catch (error variable, compensate toggle, task listings, remove handler)
- **IterationTab** — for_each (variable name, collection expression, concurrency, batch size, error policy)

### Canvas Enhancements

- **BranchBadge** component — fork chips, try_catch catch indicator, for_each iteration badge
- **NodeHandles** — default-case italic styling with ⊘ marker, condensed view with "+N more" for >5 cases
- **ARIA labels** — enhanced with branch names, count, and join policy for all branch node types
- **Duplicate detection** — `existingNames` wired from graph model into `BranchAddPopover`

### Shared Infrastructure

- `NestedTaskList` — reusable inspector component for nested task array display
- `useNestedTaskEditor` — behavior hook for nested array management
- Immutable `setNestedArray` helper — recursive path-based config mutation with structural sharing

## Benefits

- Users can manage all branch operations without touching YAML
- Visual scanning: branch names, join policies, catch handlers visible at a glance
- Accessibility: rich ARIA labels for all branch nodes
- Proto-honest: UI only shows what the DSL supports (no fake "N of M" join, no multi-catch)
- 62 new unit tests proving all commands are reversible

## Impact

- **SDK** (`@stigmer/react`): 8 new files, 11 modified files, 1099 new lines
- **CanvasActionsContext**: 9 new action methods
- **Public hook surface** (`useWorkflowCanvas`): new branch management callbacks exposed
- **Zero regressions**: all 84 branch command tests pass

## Related Work

- T08 (Contextual Task Picker) — established `AddSwitchCaseCommand`, `AddParallelBranchCommand`, `AddCatchHandlerCommand`
- T10 (Inspector Panel Refactor) — established tabbed inspector shell, `ConfigureTab`, `BranchConditionBuilder`
- T06 (Branch Execution Highlighting) — execution-time branch dimming
- DD-T03-003 (Flat graph model) — preserved; no compound node expansion

---

**Status**: ✅ Production Ready
**Timeline**: Single session
