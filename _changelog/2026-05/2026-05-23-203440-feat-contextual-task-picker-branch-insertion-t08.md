# Contextual Task Picker and Branch-Specific Insertion (T08)

**Date**: May 23, 2026

## Summary

Implemented a context-aware task insertion experience for the workflow visual editor. The picker now shows intelligent suggestions based on what precedes the insertion point, renders recently-used task kinds, disables structurally incompatible kinds with explanatory tooltips, and provides dedicated affordances for adding cases/branches/handlers to control-flow nodes. Append-after rewiring ensures new nodes are spliced before `__end__` instead of dangling.

## Problem Statement

The existing task picker was a static categorized list with no awareness of graph context. Users had to manually identify which task kinds make sense after a given node, remember what they used recently, and mentally enforce structural constraints (e.g., no nested `for_each`). Adding branches to switch/fork/try-catch nodes required editing YAML directly.

### Pain Points

- No contextual suggestions — every insertion started from scratch
- No memory of recently used kinds across sessions
- No indication when a kind is incompatible with the current position
- No UI affordance for adding cases/branches/handlers to control-flow nodes
- Appending after the last node left `__end__` disconnected

## Solution

A five-phase implementation adding an intelligence layer, enhanced picker UI, branch-specific insertion commands, append-after rewiring, and comprehensive tests.

## Implementation Details

### Phase 1: Picker Intelligence Layer (`sdk/react/src/workflow/picker/`)

- `insertion-context.ts` — `InsertionContext` type with 6 modes (`edge-splice`, `append-after`, `add-at-position`, `add-switch-case`, `add-fork-branch`, `add-catch-handler`) + `buildInsertionHeader()`
- `suggestions.ts` — Static compatibility map (`SUGGESTIONS_AFTER_KIND`) encoding 15 source-kind → next-kind mappings from competitive research; branch-mode suggestions; default fallback
- `compatibility.ts` — `getDisabledKinds()` checks DSL structural constraints (no nested for_each, no fork in terminal branches); `getHiddenKinds()` filters sentinels
- `recents.ts` — localStorage-backed recently-used store with 8-entry LRU cap

### Phase 2: Enhanced Picker UI

- `usePickerData` hook — orchestrates suggestions, recents, compatibility, and search filtering into stable memoized `PickerData`
- `TaskPickerPopover` refactored — contextual header, "Suggested" section, "Recent" section, category sections with disabled state + aria-disabled + reason tooltip

### Phase 3: Branch-Specific Insertion

- `BranchAddPopover` — mode-driven inline form (case name + condition, branch name, handler name + error type) with validation
- 3 new `GraphCommand` classes: `AddSwitchCaseCommand`, `AddParallelBranchCommand`, `AddCatchHandlerCommand` — all reversible
- `NodeActions` detects branch-mode nodes and renders dedicated `+` button

### Phase 4: Append-After Rewiring

- `addSuccessorTask` detects existing edge to `__end__` and performs atomic splice (compound command: delete old edge → add node → create source→new and new→end edges)

### Phase 5: Tests

- 38 new unit tests: suggestions (10), compatibility (6), recents (9), insertion-context (8), branch-commands (11)
- E2E spec with 9 interactive test cases

## Benefits

- **Faster insertion**: Suggested kinds reduce decision time from scanning 20+ kinds to picking from 3–4 relevant options
- **Memory across sessions**: Recent section eliminates re-searching for commonly used kinds
- **Error prevention**: Disabled entries with explanatory tooltips prevent invalid graph structures before they're created
- **Direct branch management**: Switch cases, fork branches, and catch handlers can be added without YAML editing
- **Correct topology**: Append-after always maintains connectivity to `__end__`

## Impact

- **Workflow Authors**: Significantly faster and more guided task insertion experience
- **SDK Consumers**: `TaskPickerPopover` gains optional `insertionContext` + `graph` props (backward compatible — defaults to generic behavior when absent)
- **Architecture**: New `picker/` module establishes the pattern for future context-aware UI enhancements (e.g., variable auto-complete, schema suggestions)

## Related Work

- T01 (Task Type Visual Registry) — provides `TaskKindDescriptor` data consumed by `usePickerData`
- T02 (NodeShell) — `NodeActions` extended with branch affordances
- T15 (Visual Canvas Editor) — `graph-commands.ts` extended with branch mutations
- Research report `04.report.gpt.md` — source of the static compatibility map

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~3 hours)
