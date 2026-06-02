# StructuredDataViewer: Deep Nesting Support with Scalar-Leaf Bypass

**Date**: May 27, 2026

## Summary

The workflow execution inspector's structured output view now renders deeply nested data as collapsible key-value sections instead of falling back to raw JSON. The previous `MAX_RECURSIVE_DEPTH` of 2 was too conservative for real-world agent call outputs (which commonly have 3-4 nesting levels). The depth limit is raised to 5, and a scalar-leaf bypass ensures terminal objects with only scalar values always render structured regardless of depth.

## Problem Statement

When viewing task outputs in the execution inspector (Structured view), nested objects beyond one level of nesting fell back to raw JSON blocks. This was most visible in agent call outputs with structured schemas — for example, a `design_notification_campaigns` task producing `structured → campaigns[] → variants[]` where the `variants` array rendered as a JSON blob despite containing only simple string fields.

### Pain Points

- Users had to mentally parse raw JSON for data that would be far more readable as key-value pairs
- The `Structured` view toggle became misleading — it promised structured rendering but delivered JSON for common data shapes
- Agent call outputs with output schemas (the primary use case for structured output) were the most affected, since they naturally have 3+ levels of nesting

## Solution

Two-part change to `StructuredDataViewer.tsx`:

1. **Increased `MAX_RECURSIVE_DEPTH` from 2 to 5** — covers the vast majority of real-world workflow outputs without risk of layout issues from extreme nesting.

2. **Added scalar-leaf bypass** — when the depth limit is reached, the viewer checks whether the nested value contains only scalar leaf values (strings, numbers, booleans, null). If so, it renders the structured `<dl>` grid regardless of depth. This prevents unbounded recursion for complex trees while ensuring terminal objects always get the readable treatment.

## Implementation Details

**`StructuredDataViewer.tsx`** — 3 changes:

- `MAX_RECURSIVE_DEPTH` constant raised from 2 to 5
- New `isAllScalarEntries()` helper: returns true when every value in an entry list is scalar or nullish. Used by `ComplexEntry` to bypass the depth gate for terminal objects.
- New `isAllScalarObjectArray()` helper: returns true when every item in an object array contains only scalar values. Used by `ArrayEntry` for the same bypass on arrays of flat objects.
- `ComplexEntry` depth guard split: empty objects still fall back to JSON; non-empty objects at the depth limit check `isAllScalarEntries` before falling back.
- `ArrayEntry` depth guard updated: object arrays beyond the limit use `isAllScalarObjectArray` to decide between structured rendering and JSON fallback.

**`structured-data-viewer.test.tsx`** — expanded from 37 to 41 tests:

- Updated 3 existing depth-limit tests to reflect `MAX_RECURSIVE_DEPTH = 5`
- Added 4 new scalar-leaf bypass tests covering: scalar-only object bypass, scalar-only array bypass, mixed-value fallback, and complex-array fallback
- Added a real-world test matching the screenshot's data structure (`agent_execution_id` + `structured.campaigns[].variants[]`)

## Benefits

- Agent call outputs with structured schemas now render fully structured at all nesting levels (the most common and most important use case)
- No configuration needed — the viewer handles any reasonable data shape automatically
- JSON fallback still protects against pathological data (deeply nested non-scalar trees)
- Existing JSON toggle view remains available for users who prefer raw JSON

## Impact

- **SDK component**: `StructuredDataViewer` is internal to `@stigmer/react`'s execution inspector module (not a public export), so no API surface change for SDK consumers
- **All workflow execution viewers**: both web console and desktop app benefit automatically since they consume `ExecutionInspector` from the SDK

## Related Work

- `StructuredDataViewer` was originally modeled after `McpArgsView` in `tool-rendering-primitives.tsx`
- The `InputOutputTab` component (Structured/JSON toggle) is unchanged
- The `derive-task-detail.ts` data pipeline is unchanged

---

**Status**: Production Ready
