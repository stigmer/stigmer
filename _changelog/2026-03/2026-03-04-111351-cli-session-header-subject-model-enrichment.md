# CLI Session Header: Subject and Model Enrichment with In-Place Update

**Date**: March 4, 2026

## Summary

Enriches the Stigmer CLI session header panel with Subject and Model fields across both execution paths. For new executions, the subject is initially rendered as a placeholder and updated in-place via ANSI cursor movement when the backend's async title generation completes. For resumed sessions, the model and workspace fields are now populated from the latest execution data.

## Problem Statement

The session header box shown at the start of every CLI session displayed only a subset of available metadata — Agent, Session ID, and Workspaces for new executions; Session ID and Subject for resumed sessions. Users had no visibility into which model was being used or what the session subject was until after the execution completed.

### Pain Points

- New executions showed no subject at all, even though the backend generates one asynchronously within seconds
- Resumed sessions omitted the model and workspace paths, making them less informative than new executions
- No mechanism existed to update already-rendered terminal output when async data arrived

## Solution

Two-pronged approach:

1. **Resume session path**: Populate Model (from `UsageMetrics.primary_model` on the latest execution) and Workspaces (already computed but not displayed) in the session header.

2. **New execution path**: Render the header with a placeholder Subject (`–`), then use ANSI cursor movement to overwrite it in-place when the backend resolves the real subject. A background goroutine polls the session API every 2 seconds (up to 30s) to detect when the subject becomes available.

## Implementation Details

### New file: `run_stream_inline_header_update.go`

- **`subjectUpdater`**: Thread-safe struct that tracks terminal lines emitted after the header via an atomic counter. `UpdateSubject()` uses ANSI save/restore cursor + cursor-up to overwrite the Subject row in-place. Includes a safety cap (120 lines) to avoid corrupting output if the header has scrolled off screen.
- **`lineCountingWriter`**: Wraps `io.Writer` to count newlines. Both stdout and stderr share the same atomic counter so cursor positioning accounts for all terminal output.
- **`pollSessionSubject`**: Background goroutine that polls `session.GetFromBackend()` at 2s intervals. Filters out the `"Auto-created session"` sentinel via `session.ResolvedSubject()`.
- **`renderSubjectPanelRow`**: Renders a single panel content row matching the Stigmer box style (bright blue lipgloss borders), used for the in-place overwrite.
- **`setupSubjectUpdater`**: Factory that wires up the counting writers and updater, returning wrapped writers for the streaming pipeline.

### Modified: `run_agent_exec.go`

- Header now includes `Subject: –` placeholder
- After rendering, wraps stdout/stderr in counting writers
- Starts `pollSessionSubject` goroutine with context cancellation on function exit

### Modified: `run_stream.go`

- `streamAgentExecution` and `streamAgentInline` accept `dataW, statusW io.Writer` parameters instead of hard-coding `os.Stdout`/`os.Stderr`, enabling the counting writer passthrough

### Modified: `run_session.go`

- Populates `Model` from `latestExec.GetStatus().GetUsage().GetPrimaryModel()`
- Populates `Workspaces` from the already-computed `wsRoots`

### Modified: `pkg/panel/panel.go`

- Exported `RenderContentRow`, `ResolveColor`, and `Padding` so the subject updater can produce a matching panel row without duplicating rendering logic

## Benefits

- Users see all relevant session metadata (Agent, Session, Subject, Model, Workspaces) in one place from the start
- Subject appears automatically within seconds of execution start, providing immediate context
- Resume sessions now show the same richness of information as new executions
- The in-place ANSI update is invisible to the user — the placeholder silently becomes the real subject

## Impact

- **CLI UX**: Richer session header across both `stigmer run agent/...` and `stigmer run ses-xxx` paths
- **No breaking changes**: The `streamAgentExecution` signature change is internal; only 2 call sites updated
- **13 new tests** covering offset calculation, line counting, panel row rendering, updater idempotency, nil-safety, and scroll-off-screen guard

## Related Work

- Session header panel introduced in the inline streaming UX work
- Subject generation is handled by the backend's async Temporal activity
- Panel package (`pkg/panel`) provides the box-drawing primitives

---

**Status**: ✅ Production Ready
