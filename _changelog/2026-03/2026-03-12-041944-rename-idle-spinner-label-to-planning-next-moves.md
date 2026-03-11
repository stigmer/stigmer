# Rename Idle Spinner Label from "Thinking..." to "Planning next moves..."

**Date**: March 12, 2026

## Summary

Renamed the CLI idle spinner label from "Thinking..." to "Planning next moves..." to clearly distinguish between the idle-wait spinner and the thinking tool's display. This aligns with Cursor's UX pattern and eliminates ambiguity for users who saw "Thinking" in two different contexts.

## Problem Statement

The Stigmer CLI used the label "Thinking" in two separate places:
1. The `think` tool display — showing the model's reasoning output
2. The idle spinner — shown after 2 seconds of inactivity while waiting for the next response

### Pain Points

- Users could not distinguish between "the model is reasoning" and "the model is deciding what to do next"
- The dual use of "Thinking" conflated two distinct states in the execution UI
- Cursor uses "Planning next moves" for the equivalent idle state, and Stigmer should match that convention

## Solution

Changed the idle spinner label to "Planning next moves..." while keeping the thinking tool display label as "Thinking". This creates a clear semantic split:

| UI Element | Label | When Shown |
|---|---|---|
| Idle spinner | Planning next moves... | After 2s inactivity waiting for next model response |
| Think tool | Thinking | When the model uses the `think` tool to reason |

## Implementation Details

- **`run_stream_inline_spinner.go`** — Changed the `spinnerStartMsg` label from `"Thinking..."` to `"Planning next moves..."`
- **`run_stream_inline_bubbletea_test.go`** — Updated all 10 test references to use the new label in spinner setup, assertions, and priority tests
- **`run_stream_subagent.go`** — Updated historical comment referencing the old spinner label

No changes to `toolrender/render.go` — the think tool's `"Thinking"` display label remains unchanged.

## Benefits

- Clear distinction between two previously ambiguous "Thinking" states
- Consistent with Cursor's established UX pattern
- Zero risk — label-only change with comprehensive test coverage

## Impact

All CLI users will see "Planning next moves..." instead of "Thinking..." during idle waits between model responses. The thinking tool output continues to display as "Thinking".

## Related Work

- Inline renderer spinner system (`run_stream_inline_spinner.go`, `run_stream_inline_bubbletea.go`)
- Tool render display (`toolrender/render.go`, `toolrender/render_compact.go`)

---

**Status**: ✅ Production Ready
