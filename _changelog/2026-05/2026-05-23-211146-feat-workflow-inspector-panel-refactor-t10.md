# Workflow Inspector Panel Refactor (T10)

**Date**: May 23, 2026

## Summary

Refactored the workflow inspector panel from a flat-scroll monolith into a tabbed, mode-aware, single-purpose configuration surface. Added specialized editors for `agent_call` and `http_call`, a workflow-level empty state, node actions dropdown, and two new reversible graph commands — all with 38 unit tests and a 6-case E2E test suite.

## Problem Statement

The existing `WorkflowInspectorPanel` (568 lines) was a single vertically-scrolling component mixing identity editing, task configuration, data export, flow control, and deletion into one undifferentiated list. It had no workflow-level empty state, no tabbed organization, all task kinds rendered through a generic schema form, and node actions (only Delete existed) were embedded in the config body rather than a compact header.

### Pain Points

- No workflow summary when nothing is selected — just "Select a task or connection to inspect"
- No tab organization — users scrolled through Identity → Configuration → Export → Flow → Delete for every task
- `agent_call` and `http_call` (the two highest-traffic task types) used the same generic form as every other kind
- Node actions were limited to Delete as a footer button — no Duplicate, Disable, or Wrap in TryCatch from the inspector
- No path to unify design-mode and execution-mode inspectors into a consistent visual surface

## Solution

Created a new `sdk/react/src/workflow/inspector/` module (18 files) implementing the research report's Section 4.4 recommendations: a shared `InspectorShell` with consistent header, WAI-ARIA tabbed content, per-kind form dispatch, and mode-aware rendering.

## Implementation Details

### New Module Structure (`inspector/`)

| Component | Purpose |
|-----------|---------|
| `InspectorShell` | Shared layout: header + tab bar + scrollable content, routes by selection type |
| `InspectorHeader` | Node identity (click-to-rename), kind badge, category color, overflow actions menu |
| `useInspectorTabs` | Behavior hook: tab visibility per kind/mode, active tab state, reset on selection change |
| `WorkflowSummaryPanel` | Empty state: workflow identity, env vars, budget, validation issues, task distribution |
| `ConfigureTab` | Dispatches to per-kind editors or generic `TaskConfigForm` |
| `DataTab` | Export expression editing |
| `RuntimeTab` | Timeout, model, temperature, cost cap, fork join policy, for_each concurrency |
| `AdvancedTab` | Flow control, task metadata |
| `DocsTab` | YAML examples, documentation link |
| `AgentCallForm` | Specialized: agent, harness, message, model, structured output schema with conditional sections |
| `HttpCallForm` | Specialized: method+URL side-by-side, headers, conditional body (POST/PUT/PATCH only), timeout |
| `EdgeInspector` | Edge inspector (extracted from old monolith) |
| `SentinelInspector` | Start/End inspector (extracted from old monolith) |
| `ExecutionInspectorAdapter` | Thin adapter wrapping T05 execution tabs for visual consistency |
| `taskToYaml` | Single-task YAML serialization for "View YAML" action |

### New Graph Commands

- `ToggleNodeDisabledCommand` — sets/clears `x-stigmer-disabled` annotation on `node.config`, fully reversible
- `WrapInTryCatchCommand` — creates `try_catch` container node, moves target into `config.try[0]`, rewires all edges, fully reversible

### `WorkflowInspectorPanel` Refactored

Reduced from 568-line monolith to a thin 115-line wrapper that bridges the callback-based prop API from `WorkflowCanvasEditor` into the new `InspectorShell` via a consolidated `InspectorMutations` object.

### `useWorkflowCanvas` Extended

Added `toggleNodeDisabled` and `wrapInTryCatch` methods that dispatch the new commands through the existing history pipeline (undo/redo support automatic).

### `WorkflowCanvasEditor` Wired

Now passes `onDuplicateNode`, `onToggleDisabled`, `onWrapInTryCatch`, `validationErrors`, and `emptyState` (WorkflowSummaryPanel) to the inspector.

## Benefits

- **Tabbed organization**: Configure, Data, Runtime, Advanced, Docs tabs reduce cognitive load (Hick's Law)
- **Per-kind editors**: Agent call and HTTP call forms educate users about task semantics instead of showing raw field lists
- **Workflow summary**: Users see env vars, budget, validation issues, and task distribution when no node is selected
- **Node actions**: Duplicate, Disable, Wrap in TryCatch, Delete all accessible from inspector header menu
- **Mode-aware architecture**: Shared `InspectorShell` enables future unification with execution inspector
- **38 unit tests + 6 E2E test cases**: Full coverage of tab logic, form rendering, graph commands, and summary panel

## Impact

- **SDK**: New `inspector/` module with 18 files, 16 new public exports from `sdk/react/src/workflow/index.ts`
- **Client apps**: Zero changes needed — web and desktop get the refactor automatically through `WorkflowEditorView` (DD-016)
- **Backward compatible**: `WorkflowInspectorPanel` props API is additive (new optional props), `ExecutionInspector` unchanged

## Related Work

- T01: Task Type Visual Registry (provides kind metadata for inspector header)
- T05: Runtime Execution Inspector (established tabbed pattern reused here)
- T08: Contextual Task Picker (separated task creation from inspector)
- T15: Visual Canvas Editor (created the original `WorkflowInspectorPanel`)
- Research report Section 4.4: Inspector Panel design recommendations

---

**Status**: ✅ Production Ready
**Timeline**: Single session
