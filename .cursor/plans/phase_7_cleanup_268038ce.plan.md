---
name: Phase 7 Cleanup
overview: "Systematic cleanup of the Bubbletea inline renderer: remove confirmed dead code, fix stale comments, split oversized files to meet the 250-line guideline, and refactor oversized functions to meet the 50-line guideline. All changes are behavior-preserving."
todos:
  - id: step-1-dead-code
    content: "Remove dead code: termctl.SaveCursor/RestoreCursorAndClear + lastRenderedRunningID/runningLineRendered tracking + corresponding tests"
    status: completed
  - id: step-2-comments
    content: Fix stale comments in termctl.go, approval.go, spinner.go referencing deleted constructs
    status: completed
  - id: step-3-split-inline
    content: Split run_stream_inline.go (658 lines) into types + render + core files
    status: completed
  - id: step-3-split-approval
    content: Split run_stream_inline_approval.go (464 lines) into flow + display helper files
    status: completed
  - id: step-3-split-bubbletea
    content: Extract message types from run_stream_inline_bubbletea.go (357 lines)
    status: completed
  - id: step-4-refactor-streaming
    content: Refactor renderToolStreamDeltaDirect (90 lines) into 3 smaller focused functions
    status: completed
  - id: step-5-verify
    content: Run tests, go vet, update BUILD.bazel for new files
    status: completed
isProject: false
---

# Phase 7: Cleanup -- Dead Code Removal, File Splitting, Comment Hygiene

## Scope

14 source files under `client-apps/cli/cmd/stigmer/root/run_stream_inline*.go` and `client-apps/cli/pkg/termctl/`. All changes are behavior-preserving refactors -- no new features, no UX changes. Tests must pass identically after each step.

---

## Step 1: Dead Code Removal

### 1a. Remove `termctl.SaveCursor` + `RestoreCursorAndClear`

**Why:** Zero production callers anywhere in the codebase. Only defined + tested in [termctl.go](client-apps/cli/pkg/termctl/termctl.go) and [termctl_test.go](client-apps/cli/pkg/termctl/termctl_test.go). These were part of the pre-Bubbletea approval flow that no longer exists.

- Delete `SaveCursor` (lines 39-50) and `RestoreCursorAndClear` (lines 52-62) from `termctl.go`
- Delete their 4 test functions from `termctl_test.go` (`TestSaveCursor_WritesSequence`, `TestRestoreCursorAndClear_WritesSequence`, `TestSaveCursor_NoopForBuffer`, `TestRestoreCursorAndClear_NoopForBuffer`)

### 1b. Remove `lastRenderedRunningID` + `runningLineRendered` dead tracking

**Why:** All `ToolRunningEvent` are suppressed in `handleEvent` (lines 247-292 of [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)). `lastRenderedRunningID` is never set to a non-empty value. `runningLineRendered` is always `false`. Every `else if runningRendered` branch is unreachable.

Files affected:

- **[run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go)**: Remove `lastRenderedRunningID` field (line 96), remove `runningLineRendered` from `waitingApprovalState` (line 59), remove the `runningLineRendered: r.lastRenderedRunningID == e.ToolCallID` assignment in `renderToolWaitingApproval` (line 469)
- **[run_stream_inline_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go)**: Remove `runningRendered` parameter from `handleNonInteractiveApproval`, `handleInteractiveApproval`, `erasePreApprovalContent`, and `resolveApprovalContext`. Simplify: remove `else if runningRendered { EraseLines(1) }` branches in `handleNonInteractiveApproval` (line 108-109) and `erasePreApprovalContent` (line 185-186)
- **[run_stream_inline_approval_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval_test.go)**: Remove tests that set `lastRenderedRunningID` and assert `runningLineRendered`. Update remaining test structs to remove the field
- **[run_stream_inline_streaming_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming_test.go)**: Update `waitingApprovalState` literals to remove `runningLineRendered`

### 1c. Verify `mockAutoApprovePrompter` in bubbletea test

The explore agent flagged `mockAutoApprovePrompter` (lines 517-521 of [run_stream_inline_bubbletea_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea_test.go)) as potentially unused. Verify with the compiler after step 1b -- if unused, remove.

---

## Step 2: Stale Comment Cleanup

### 2a. `termctl.go` comments

Three comments reference deleted constructs:

- Line 25: "line-counting middleware" -- `lineCountingWriter` was deleted in Phase 3. Rewrite to generic: "wrapped writer (e.g., buffered middleware)"
- Lines 40-42: "subject updater uses SCO" -- `subjectUpdater` no longer exists. Remove the entire comparison clause; simplify to just document what `SaveCursor` does (or remove with the function in step 1a)
- Lines 120-121: "line-counting wrappers used for session header updates" -- rewrite to generic: "middleware that wraps the underlying file"

### 2b. Approval comment

- [run_stream_inline_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go) line 25: `approvalContentBudget` comment references "EraseLines-based collapse" -- update to reflect both Bubbletea View() and direct-write paths

### 2c. Spinner comment

- [run_stream_inline_spinner.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_spinner.go) line 29: "Unlike the former goroutine-based spinner.Stop() (synchronous)" -- the "former" framing is stale migration commentary. Simplify to describe the current async behavior directly.

---

## Step 3: File Splitting

### Current state vs. target


| File                             | Current | Target                     | Strategy                                 |
| -------------------------------- | ------- | -------------------------- | ---------------------------------------- |
| `run_stream_inline.go`           | 658     | ~150 + ~230 + ~230         | Extract types; extract rendering methods |
| `run_stream_inline_approval.go`  | 464     | ~250 + ~200                | Extract display helpers                  |
| `run_stream_inline_bubbletea.go` | 357     | ~95 + ~262                 | Extract message types                    |
| `run_stream_inline_streaming.go` | 320     | ~250 (after func refactor) | Refactor functions only                  |


### 3a. Split `run_stream_inline.go` (658 lines)

Create two new files:

`**run_stream_inline_types.go`** (~150 lines): Move all type definitions and constants:

- `readGroupThreshold` constant
- `inlineRenderConfig` struct
- `pendingRead` struct
- `waitingApprovalState` struct (after dead field removal)
- `inlineRenderer` struct + all its field comments

`**run_stream_inline_render.go`** (~230 lines): Move all rendering methods:

- AI rendering: `renderAIStreamStart`, `renderAIStreamDelta`, `renderAIStreamEnd`, `renderAIMessage`, `renderHumanMessage`
- Tool rendering: `renderToolCompleted`, `renderToolWaitingApproval`
- Status/lifecycle: `renderSystemMessage`, `renderPhaseChange`, `renderTodoUpdate`, `renderSubAgentStarted`, `renderSubAgentCompleted`
- Terminal: `renderDone`, `renderStreamError`
- Read grouping: `flushPendingReads`
- Helpers: `finishAIStreamIfNeeded`, `agentPrefix`, `statusf`, `flushData`, `flushWriter`, `actionToString`

`**run_stream_inline.go`** (remaining ~230 lines): Keep `renderInline` event loop + `handleEvent` dispatch. These are the core control flow and belong together.

### 3b. Split `run_stream_inline_approval.go` (464 lines)

Create one new file:

`**run_stream_inline_approval_display.go`** (~170 lines): Move display/helper functions:

- `approvalContentBudget` + `approvalOverheadRows` constant
- `resolveApprovalContext`
- `buildExpandedView`
- `promptForDecision`
- `formatCollapsedResult`
- `printCollapsedResult`
- `trackSuppression`
- `handlePromptError`
- `handlePromptErrorAfterHide`
- `handleSessionExit`

`**run_stream_inline_approval.go`** (remaining ~250 lines): Keep the orchestration flow:

- `handleApproval`
- `handleNonInteractiveApproval`
- `handleInteractiveApproval`
- `erasePreApprovalContent`
- `promptApprovalViaBubbletea`
- `promptApprovalDirect`
- `finalizeApproval`

### 3c. Extract messages from `run_stream_inline_bubbletea.go` (357 lines)

Create one new file:

`**run_stream_inline_messages.go`** (~95 lines): All Bubbletea message type definitions:

- `spinnerStartMsg`, `spinnerStopMsg`, `spinnerTickMsg`
- `approvalShowMsg`, `approvalSelectMsg`, `approvalHideMsg`
- `streamingShowMsg`, `streamingUpdateMsg`, `streamingHideMsg`
- `followUpShowMsg`, `followUpHideMsg`

`**run_stream_inline_bubbletea.go**` (remaining ~262 lines): Model struct + Init/Update/View + all handlers + `formatStreamingView`. At 262 lines, this exceeds 250 by a small margin. Justification: all methods operate on a single model type; splitting handlers from the model they mutate adds navigation cost without reducing complexity. If you prefer strict compliance, `formatStreamingView` (44 lines) can move to `run_stream_inline_streaming.go`, bringing the file to ~218 lines.

---

## Step 4: Function Size Refactoring

### 4a. Refactor `renderToolStreamDeltaDirect` (90 lines -> 3 functions)

In [run_stream_inline_streaming.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming.go) lines 162-251, the function has three clear paths:

- **Uncapped mode** (lines 168-183): Post-approval, no line limit -- extract to `renderStreamDeltaUncapped`
- **Capped, at limit** (lines 193-209): Truncation indicator update -- extract to `renderStreamOverflowUpdate`
- **Capped, not at limit** (lines 211-250): Incremental line rendering -- extract to `renderStreamDeltaCapped`

The parent `renderToolStreamDeltaDirect` becomes a ~15-line router.

### 4b. Extract pre-switch interceptions from `handleEvent` (optional)

`handleEvent` is 163 lines. The pre-switch filter logic (lines 220-292) could be extracted into a `filterEvent` method returning `(event, skip bool)`. This would reduce `handleEvent` to ~100 lines. However, filter-then-switch patterns add a level of indirection. I recommend evaluating after steps 1-3 reduce the file -- the cognitive load may already be manageable.

---

## Step 5: Verify and Update Build

- Run `go test ./client-apps/cli/cmd/stigmer/root/...` -- all tests must pass
- Run `go vet ./client-apps/cli/...` -- no warnings
- Update `BUILD.bazel` to include new source files if using Bazel

---

## What is NOT being removed

- `**program == nil` fallback paths**: These support non-TTY/CI environments and unit tests. They are legitimate production code, not dead code.
- `**pkg/spinner` package**: Still used by `run_stream.go`, `run_session.go`, `run.go`, `draft_handler.go`. Only `Frames`/`FormatElapsed`/`FrameInterval` are used by the inline renderer. The goroutine-based `Spinner` struct serves other commands.
- `**termctl.EraseLines` / `DisplayRows` / `Width` / `Height`**: Used by the direct-write fallback path and by `pkg/approval/inline_prompter.go`.
- `**PromptWithLineCount` / `rerenderMenu`**: Used by the direct-write approval path (promptForDecision delegates to it).
- `**unwrapFile` Unwrap chain in termctl**: Defensive code for wrapped writers -- harmless even though `lineCountingWriter` is gone.

