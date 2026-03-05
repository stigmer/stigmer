# Phase 5: Tool Streaming Migration to Bubbletea View()

**Date**: March 5, 2026

## Summary

Migrated both pre-approval and post-approval tool content streaming from direct stderr writes into the Bubbletea model's `View()` method. This eliminates the remaining 4 `termctl.EraseLines` call sites that relied on manual cursor math for streaming content, while preserving the direct-write fallback for non-TTY environments and tests.

## Problem Statement

The streaming subsystem violated a core boundary: it wrote directly to stderr via `fmt.Fprint(r.cfg.status, ...)`, bypassing Bubbletea's row tracking. This forced manual cursor math (`EraseLines`) to undo those writes — the exact class of fragile ANSI cursor manipulation that the Bubbletea migration is eliminating.

### Pain Points

- Pre-approval streaming content (write/edit tool content preview) was written directly to stderr, then erased via `EraseLines` before showing the approval panel
- Post-approval streaming content (shell command output) was written directly, then erased via `EraseLines` on completion to show the compact result
- Truncation indicator for capped content was updated in-place via `EraseLines(1)` — manual row tracking
- All 4 call sites depended on precise `streamLineCount` arithmetic that could break with terminal width changes or content wrapping

## Solution

Streaming content becomes model state owned by the Bubbletea model. `View()` renders it. `Update()` manages transitions. The event loop sends data messages but never writes to stderr for streaming content when a Bubbletea program is running.

## Implementation Details

### New Message Protocol

Three messages added to the Bubbletea model:

- `streamingShowMsg` — activates streaming in `View()` with pre-rendered header, content cap, and terminal width
- `streamingUpdateMsg` — delivers the full accumulated content (not deltas); `View()` formats on each render
- `streamingHideMsg` — deactivates streaming; optionally commits collapsed result via `tea.Println`

### View() Rendering Priority

Updated to: `approval > streaming > spinner > empty`. The `approvalShowMsg` handler atomically clears streaming state, ensuring no intermediate empty frame when transitioning from streaming to the approval panel.

### Pure Formatting Function

`formatStreamingView(header, content, subAgentID, maxLines, width)` handles all display logic: width-clamping, line-capping, truncation indicator, and gutter-wrapping for sub-agents. It's a pure function — no side effects, testable in isolation.

### Dual-Path Architecture

Each streaming function (`initPreApprovalStreaming`, `renderToolStreamDelta`, `initPostApprovalStreaming`, `completeStreamingTool`) now branches on `r.cfg.program != nil`:

- **Bubbletea path**: sends messages to the model
- **Direct-write path**: existing behavior preserved unchanged (for tests and non-TTY)

## Benefits

- **4 fewer EraseLines**: All 4 target call sites are now unreachable in the Bubbletea path
- **No manual cursor math for streaming**: Bubbletea handles row tracking automatically
- **Pure formatting logic**: `formatStreamingView` is testable without terminal interaction
- **Atomic transitions**: Streaming → approval transition has no visual glitch
- **Zero test changes**: All existing tests (using `program == nil`) pass unchanged; 14 new model tests added

## Impact

- **Files changed**: 4 (`run_stream_inline_bubbletea.go`, `run_stream_inline_streaming.go`, `run_stream_inline_approval.go`, `run_stream_inline_bubbletea_test.go`)
- **Lines**: +506 / -73
- **Tests**: 14 new streaming model tests
- **EraseLines remaining**: 8 in approval.go (direct-write fallback), 2 in streaming.go (direct-write only), 1 in followup.go (Phase 6 scope)

## Related Work

- Builds on [Phase 4: Approval Flow Migration](2026-03-05-051651-phase-4-approval-flow-bubbletea-migration.md)
- Builds on [Phase 1-3 Foundation](2026-03-05-033212-bubbletea-inline-renderer-phase-1-foundation.md)
- Next: Phase 6 (Follow-up Prompt Migration) will eliminate the last `EraseLines` in `followup.go`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~45 minutes)
