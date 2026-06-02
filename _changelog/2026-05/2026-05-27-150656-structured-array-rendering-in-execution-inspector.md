# Structured Array Rendering in Execution Inspector

**Date**: May 27, 2026

## Summary

Enhanced the `StructuredDataViewer` component to render arrays of objects as structured, collapsible item cards instead of raw JSON. This closes the last major gap in the execution inspector's structured data display, making outputs like cohort lists, anomaly reports, and error arrays immediately scannable without parsing JSON syntax.

## Problem Statement

The recent execution inspector UX overhaul replaced raw JSON with a structured key-value renderer for scalar fields and nested objects. However, arrays of objects -- one of the most common output shapes from agent-call tasks -- still fell through to a `CollapsibleJsonBlock` that rendered raw `JSON.stringify` output.

### Pain Points

- Arrays like `cohorts` (5 objects with `name`, `size`, `retention_trend`, `action_needed`) rendered as a collapsed JSON block, forcing users to expand and visually parse braces, quotes, and commas
- The JSDoc on `StructuredDataViewer` claimed arrays of objects rendered as "numbered collapsible items" but the implementation never existed -- it was aspirational
- The depth budget (`MAX_RECURSIVE_DEPTH = 2`) would have blocked array items from rendering structurally even if the code existed, since arrays nested inside `structured` at depth 1 would hit the ceiling at depth 2

## Solution

Three coordinated enhancements to `ArrayEntry` in `StructuredDataViewer.tsx`:

1. **Object array detection** -- When all items in an array are plain objects (not mixed with scalars or nested arrays), and the current depth allows recursion, render each item as a structured card instead of JSON.

2. **`ObjectArraySection` + `ObjectArrayItem`** -- New sub-components that render a collapsible outer section with item count, and numbered collapsible cards per item. Each card reuses `ObjectEntries` for recursive structured rendering, maintaining full consistency with the existing scalar/complex split.

3. **Item label heuristic** -- Extracts `name`, `title`, `label`, or `id` (in priority order) from each object to show as a subtitle alongside the index (e.g., "Item 1 -- D1 New Users"), providing instant recognition without expanding.

## Implementation Details

### Depth Accounting (Option B from Plan)

Arrays don't consume a depth level -- only the items inside them do. The check `depth < MAX_RECURSIVE_DEPTH` is on the array itself, and items render at `depth + 1`. This means:

- Top-level arrays (depth 0): items render at depth 1 -- full structural rendering
- Arrays inside nested objects like `structured.cohorts` (depth 1): items render at depth 2 -- scalar fields display cleanly in `<dl>` grids
- Arrays at depth >= 2: fall back to `CollapsibleJsonBlock` JSON -- unchanged

### Auto-collapse Threshold

Individual items start collapsed when the array has > 3 items to avoid viewport flooding. Arrays with <= 3 items start with all items expanded for immediate visibility.

### Shared ChevronIcon

Extracted the inline chevron SVG into a shared `ChevronIcon` component, eliminating duplication across `NestedSection`, `ObjectArraySection`, and `ObjectArrayItem`.

### Fallback Preservation

Mixed arrays (objects + scalars), arrays of arrays, and arrays at depth >= `MAX_RECURSIVE_DEPTH` still fall through to `CollapsibleJsonBlock` -- no behavioral change for these cases.

### Tests

- Updated the existing "renders object array as collapsible JSON" test to verify structured rendering
- 16 new test cases covering: structured items with count, scalar fields inside items, singular/plural labels, mixed array fallback, label heuristic priority (name > title > label > id), no-subtitle fallback, non-scalar label skipping, collapse/expand behavior, outer section collapse, empty objects, depth-1 structured rendering, depth >= MAX JSON fallback
- Total: 33 tests (up from 17), all passing

## Benefits

- Users monitoring workflow outputs like `daily-notification-plan` can instantly scan cohort data, anomaly lists, and error arrays without parsing JSON
- The label heuristic surfaces the most recognizable field (name, title) as a subtitle, enabling quick identification across collapsed items
- Depth accounting preserves the recursion safety net while allowing arrays at any practical nesting level to render structurally

## Impact

- **Direct users**: Every workflow execution output containing arrays of objects now renders structured cards instead of raw JSON
- **SDK consumers**: Changes are in `@stigmer/react` -- platform builders embedding `<WorkflowExecutionViewer>` or `<ExecutionInspector>` get this automatically
- **Client app parity**: Zero changes to `client-apps/web` or `client-apps/desktop`

## Related Work

- [Execution Inspector Data Display UX Overhaul](2026-05-27-144435-execution-inspector-data-display-ux-overhaul.md) -- the parent overhaul that introduced `StructuredDataViewer`
- `McpArgsView` pattern in `sdk/react/src/execution/McpToolDetail.tsx` -- the architectural template

---

**Status**: Production Ready
**Timeline**: Single session
