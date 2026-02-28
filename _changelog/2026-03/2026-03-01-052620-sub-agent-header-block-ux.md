# Sub-Agent Header Block: From Dim Separator to Informative Context

**Date**: March 1, 2026

## Summary

Replaced the minimal dim separator line (`── general-purpose ──`) shown during sub-agent execution with a proper expandable header block that displays the sub-agent type, a concise task description, and (on expand) the full prompt. This threads existing proto data through the bridge layer that was previously dropping it, giving CLI users immediate visibility into what each sub-agent was delegated to do.

## Problem Statement

When the main agent delegates work to a sub-agent via the `task` tool, the CLI showed only a dim separator with the sub-agent type name. Users had no way to tell:

### Pain Points

- **No task context**: The separator said "general-purpose" but nothing about what the sub-agent was asked to do
- **Data dropped on the floor**: The proto `SubAgentExecution` already carried `input` (full task prompt) and `started_at`, but the bridge layer only forwarded `ID` and `Name`
- **`description` never captured**: The task tool provides a concise 3-5 word summary (`description` arg) that the backend never extracted
- **Not interactive**: Unlike every other content block in the TUI, the sub-agent boundary could not be expanded for detail

## Solution

Thread existing proto data through the full pipeline (backend -> proto wire -> CLI bridge -> TUI) and render sub-agent introductions as proper expandable content blocks, following the same visual language and interaction patterns as tool blocks.

## Implementation Details

### Backend (1 file)

- **`status_builder.py`**: Captures `description` from task tool args into `SubAgentExecution.metadata` (protobuf Struct). No proto schema change needed.

### CLI Bridge (1 file)

- **`run_stream_subagent.go`**: Extracts `sa.Input` and `sa.Metadata.Fields["description"]` from the proto and populates the enriched `SubAgentStartedEvent`. Previously dropped both fields.

### TUI (6 files)

- **`events.go`**: Added `Input` and `Description` fields to `SubAgentStartedEvent`
- **`model.go`**: Replaced `subAgentNames map[string]string` with `subAgentMeta map[string]subAgentInfo` struct holding `Name`, `Input`, and `Description`
- **`blocks.go`**: Added `blockSubAgent` type and `newSubAgentBlock` constructor for expandable header blocks
- **`render_blocks.go`**: Added `renderSubAgentHeader` (collapsed: `🔀 name ─ description`), `renderSubAgentHeaderExpanded` (header + gutter-bordered full prompt), `truncateAtWord` helper. Updated `needsSubAgentSeparator` to skip `blockSubAgent` blocks. Kept `renderSubAgentSeparator` for rare re-entry cases.
- **`handle_events.go`**: `SubAgentStartedEvent` handler now creates an expandable header block. All `subAgentNames` references updated to `subAgentMeta`.
- **`scroll.go`**: Doc comment updated; logic correct via delegation to updated `needsSubAgentSeparator`.

### Target UX

**Collapsed (default):**
```
  🔀 general-purpose ─ Explore CLI sub-agent rendering ▶
```

**Expanded:**
```
  🔀 general-purpose ─ Explore CLI sub-agent rendering ▼
     │ I need to understand how sub-agent execution is currently
     │ rendered in the Stigmer CLI. The CLI is a Go application...
```

## Benefits

- Users can immediately see what task was delegated to each sub-agent at a glance
- The full prompt is available on demand via Tab + Enter (same pattern as tool blocks)
- No proto schema changes or `buf generate` required -- uses existing `metadata` Struct field
- Consistent visual language with the rest of the TUI (gutter borders, expand/collapse indicators)

## Impact

- **CLI users**: Dramatically improved visibility into sub-agent delegation during `stigmer run` sessions
- **Backend**: Additive-only change -- existing fields untouched, metadata now populated
- **8 files changed** across backend and CLI (1 Python, 7 Go)

## Related Work

- Builds on the sub-agent visibility infrastructure added in Phase 2.3 (internal execution visibility)
- Uses the same expand/collapse interaction pattern as tool blocks and todo blocks

---

**Status**: ✅ Production Ready
