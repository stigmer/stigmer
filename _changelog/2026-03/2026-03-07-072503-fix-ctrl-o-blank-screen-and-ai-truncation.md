# Fix Ctrl+O Blank Screen and AI Message Truncation

**Date**: March 7, 2026

## Summary

Fixed two rendering bugs in the inline TUI: (1) Ctrl+O re-commit desynced BubbleTea v2's cursor tracker causing a blank screen, and (2) `TodoUpdateEvent` prematurely terminated active AI streams causing the AI message to appear truncated. Both fixes are targeted at the re-commit and event pre-switch logic — no architectural changes.

## Problem Statement

Two distinct issues were degrading the inline rendering experience, each rooted in a different subsystem of the re-commit / event dispatch pipeline.

### Pain Points

- **Ctrl+O clears screen**: Pressing Ctrl+O during execution wiped the terminal and left a blank screen. The entire session history (header, tools, AI messages) disappeared until a new event triggered a re-render.
- **AI message truncated by todo items**: When the agent emitted a `TodoUpdateEvent` mid-stream, the AI message was cut off at the point where the todo arrived. The remaining content was silently dropped from the display, even though the backend had delivered it.

## Solution

Three targeted fixes, each addressing a specific root cause:

1. **Unified re-commit command** — Replaced the execution-mode `buildReCommitCmd` (which used `tea.Raw` only, desyncing the renderer) with a single renderer-aware function used by all modes: `Raw(clearAndHome)` → `ClearScreen` → `Println(history)` → `reCommitDoneMsg`. Deleted `buildFollowUpReCommitCmd`.

2. **Deferred re-commit during AI streaming** — Added `pendingReCommit` flag. When a re-commit trigger (Ctrl+O, subject update) fires during an active AI stream, the re-commit is deferred until the stream ends. This prevents content loss since AI stream lines are not stored in history until `AIStreamEnd`.

3. **TodoUpdateEvent exemption** — Added `TodoUpdateEvent` as a dedicated case in the pre-switch, skipping `finishAIStreamIfNeeded()`. Todo updates only affect the composed View (via `planDisplay`) and must not interrupt the AI stream.

4. **Safety-net recovery re-commit** — In `renderAIStreamEnd`'s early-return path (stream was interrupted), triggers a re-commit after `recordAIMessage` to recover the full AI content from history.

## Implementation Details

### Unified `buildReCommitCmd`

**File**: `run_stream_inline_history.go`

The old execution-mode function wrote history content directly via `tea.Raw(clearAndHome + history)`, bypassing BubbleTea v2's `cursedRenderer` cursor tracking. After `reCommitDoneMsg` re-enabled `View()`, the renderer wrote the composed view at its stale tracked position — potentially hundreds of rows off from where the actual cursor sat. The terminal appeared blank.

The new unified function uses `ClearScreen` to reset the renderer to (0,0), then `tea.Println` to write history through the renderer's tracked path. The key insight: `Println` executes while `reCommitPending` is still true, so `View()` returns empty and the renderer writes only the history content — no flicker.

`buildFollowUpReCommitCmd` was deleted. `handleReCommit` no longer branches on `inputBarMode`.

### Deferred Re-commit

**Files**: `run_stream_inline_types.go`, `run_stream_inline.go`, `run_stream_inline_aistream.go`

During AI streaming, individual lines are committed to scrollback via `writeToScrollback(kindAIStreamLine, ...)` but are NOT stored in `r.history`. Only the final `kindAIMessage` (at stream end) goes into history. A re-commit during streaming would clear the screen and re-render from history — losing all AI stream lines.

The fix: when `recommitNeeded` is true but `r.inAIStream` is also true, set `r.pendingReCommit = true` instead of calling `triggerReCommit()`. After each `handleEvent`, check if `pendingReCommit && !inAIStream` and fire the deferred re-commit. Also handled inside `renderAIStreamEnd` (both normal and early-return paths) to fire promptly when the stream ends.

### TodoUpdateEvent Exemption

**File**: `run_stream_inline.go`

The pre-switch in `handleEvent` called `finishAIStreamIfNeeded()` for ALL events in the `default` branch. `TodoUpdateEvent` fell into this branch, prematurely closing the AI stream. Subsequent `AIStreamDelta` events were silently dropped (`if !r.inAIStream { return }`). The `AIStreamEnd` event took the early-return path which recorded content to history but never displayed the missing portion.

The fix: add `TodoUpdateEvent` as a dedicated case that skips both `finishAIStreamIfNeeded()` and `flushPendingReads()`.

### Recovery Re-commit

**File**: `run_stream_inline_aistream.go`

In the `!r.inAIStream` early-return path of `renderAIStreamEnd`, after `recordAIMessage` stores the full content in history, trigger a re-commit. This ensures content recovery even if other events prematurely close an AI stream in the future.

## Benefits

- **Ctrl+O works reliably**: Toggle between compact and expanded mode without losing any content, in all phases — execution, follow-up, and approval
- **No more truncated AI messages**: Todo updates coexist with active AI streams; the full agent response is always displayed
- **Unified re-commit path**: One function instead of two eliminates a class of mode-specific rendering bugs
- **Defensive recovery**: The safety-net re-commit in `AIStreamEnd` protects against future event ordering surprises

## Impact

- **End users**: Ctrl+O and todo updates are now reliable during all phases of agent execution
- **Code quality**: Removed `buildFollowUpReCommitCmd` and the `inputBarMode` branching in `handleReCommit`, reducing code surface
- **Maintainability**: The `pendingReCommit` pattern provides a clean solution for "re-commit during streaming" without tracking individual stream lines in history

## Related Work

- Builds on [Smart Ctrl+O Expand and Approval Toggle](2026-03-07-060619-smart-ctrl-o-expand-and-approval-toggle.md) which introduced the expand hint and approval-aware toggle
- Builds on [Expandable Errors and Follow-up Recommit Fix](2026-03-07-064556-expandable-errors-and-follow-up-recommit-fix.md) which introduced `buildFollowUpReCommitCmd`
- Root cause of Cause A (cursor desync) traces back to [Fix Recommit Scrollback Duplication via Raw](2026-03-06-013928-fix-recommit-scrollback-duplication-via-raw.md) which introduced the `tea.Raw`-only execution-mode path

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (including deep root-cause analysis across re-commit pipeline and event dispatch)
