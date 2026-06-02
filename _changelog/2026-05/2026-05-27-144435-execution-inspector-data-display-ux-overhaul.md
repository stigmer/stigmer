# Execution Inspector Data Display and Panel UX Overhaul

**Date**: May 27, 2026

## Summary

Replaced the raw JSON display in the workflow execution inspector's Input/Output tabs with a structured, human-readable key-value renderer; made the inspector right panel drag-resizable with persistent width; and added copy/download actions for task data export. All changes are in the SDK layer (`@stigmer/react`), maintaining automatic parity across web and desktop client apps.

## Problem Statement

The workflow execution inspector's Input/Output tabs rendered task data as raw `JSON.stringify` output in a monospace `<pre>` block. Users monitoring production workflows (e.g., daily notification plans) had to mentally parse JSON syntax to extract meaning from execution results.

### Pain Points

- JSON punctuation (braces, quotes, commas) is noise when users want to read values like executive summaries, agent execution IDs, and structured metrics
- The right panel was fixed at 320-384px with no way to expand it for data-rich outputs
- No copy or download capability for task I/O data, forcing users to manually select and copy from the `<pre>` block
- The `panelOffsetPx` prop on `WorkflowExecutionGraph` was never wired, causing the graph's follow-execution centering to ignore the panel's occluded viewport area

## Solution

Three coordinated changes, all following established SDK patterns:

1. **StructuredDataViewer** — Type-aware renderer following the `McpArgsView` scalar/complex split pattern. Scalars in a `<dl>` grid with humanized labels, nested objects as collapsible sections, long prose strings as wrapped paragraphs, with a Structured/JSON view toggle.

2. **ResizableSplit** — Lightweight internal split-panel primitive with pointer-based drag, keyboard accessibility (Arrow keys), localStorage persistence, and an `onResize` callback that threads the panel width to `WorkflowExecutionGraph.panelOffsetPx`.

3. **Copy/Download actions** — Clipboard copy with feedback and JSON file download buttons in the Input/Output tab toolbar, following the `ArtifactPreviewModal` interaction pattern.

## Implementation Details

### New Components

- `sdk/react/src/internal/ResizableSplit.tsx` — Horizontal split layout with drag-resizable right panel. Uses `setPointerCapture` for reliable tracking, `requestAnimationFrame` coalescing during drag (DD-009), ARIA separator role, `--stgm-*` token styling. ~120 lines, zero dependencies.

- `sdk/react/src/workflow/execution-inspector/StructuredDataViewer.tsx` — Renders `JsonObject` using the `McpArgsView` scalar/complex split: `isScalar()` and `humanizeArgKey()` from `tool-rendering-primitives.tsx`, `CollapsibleJsonBlock` for complex values. Extensions: prose detection (>120 chars, non-ID/URL), recursive nesting to depth 2 with JSON fallback, inline scalar arrays (<=5 items). ~150 lines.

### Modified Components

- `InputOutputTab.tsx` — Replaced `CollapsibleCode` with `StructuredDataViewer` as default view. Added Structured/JSON toggle following `ArtifactContentRenderer`'s rendered/source pattern. Added CSS-only JSON syntax highlighting (keys, strings, numbers, booleans) matching `ArtifactContentRenderer.highlightJson`. Added Copy and Download buttons with clipboard feedback and `aria-live` screen reader announcements.

- `WorkflowExecutionViewer.tsx` — Replaced fixed-width `<aside>` with `ResizableSplit`. Added `panelWidth` state threaded to `WorkflowExecutionGraph.panelOffsetPx` (fixing an existing deficiency where follow-execution centering ignored the panel). Both inspector and diagnosis modes use the resizable panel.

### Tests

- 17 unit tests for `StructuredDataViewer`: empty state, scalar types, null handling, long-string prose detection, ID/URL exclusion, nested object recursion, depth-2 fallback, array variants, mixed data separation, collapse toggle
- 16 unit tests for `ResizableSplit`: rendering, ARIA attributes, default/custom sizes, localStorage persistence, keyboard interaction, clamping, onResize callback, accessibility
- All 15 existing `ExecutionInspector` tests pass unchanged
- All 45 existing `deriveTaskDetail` tests pass unchanged
- 1 new E2E test for resize handle presence and accessibility

## Benefits

- Users can instantly scan task data without parsing JSON syntax — scalar values are labeled and formatted, prose fields are readable text
- Panel width is user-controlled (280-800px range) and persisted across sessions
- Graph follow-execution centering now accounts for the panel width via `panelOffsetPx`
- Task data is exportable (copy to clipboard, download as JSON file) for sharing and debugging
- Power users retain full JSON access via the view toggle with syntax highlighting

## Impact

- **Direct users**: Every workflow execution detail view now shows structured data by default with resizable panel
- **Platform builders**: Changes are in `@stigmer/react` SDK components — platform builders embedding `<WorkflowExecutionViewer>` or `<ExecutionInspector>` get these improvements automatically
- **Client app parity**: Zero changes to `client-apps/web` or `client-apps/desktop` — DD-016 maintained by construction

## Related Work

- `McpArgsView` pattern in `sdk/react/src/execution/McpToolDetail.tsx` — the architectural template for structured data rendering
- `ArtifactContentRenderer` in `sdk/react/src/execution/ArtifactContentRenderer.tsx` — the template for view toggles and JSON syntax highlighting
- `useFollowExecution` / `panelOffsetPx` in `sdk/react/src/workflow/useFollowExecution.ts` — the centering calculation that now receives the actual panel width

---

**Status**: Production Ready
**Timeline**: Single session
