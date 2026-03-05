# Next Task: 20260305.02.expand-collapse-tools

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260305.02.expand-collapse-tools

**Description**: Build an event history + clear+re-commit mechanism for the Stigmer CLI inline renderer. Enables: (1) session header subject update without ANSI cursor math, (2) expand/collapse toggle for tool executions similar to Claude Code's Ctrl+O, (3) read-file group expansion, and (4) a general-purpose re-render capability for future triggers (terminal resize, theme toggle).
**Goal**: Retain structured event data in the Bubbletea model so the entire session can be re-rendered on demand. First use case: subject update. Primary use case: Ctrl+O expand/collapse toggle for tool calls and read groups.
**Tech Stack**: Go / Bubbletea (charmbracelet)
**Components**: inline renderer (run_stream_inline*.go), Bubbletea model (run_stream_inline_bubbletea.go), toolrender package, model state retention, key binding handling

## Current Status

**Created**: 2026-03-05 05:00
**Current Task**: T02 — Phase 4 (Follow-up and resume support)
**Status**: Ready to begin Phase 4
**Last Session**: 2026-03-05 (Session 3)

## Session Progress (2026-03-05, Session 3)

### Completed
- **T02 Phase 3**: Ctrl+O Keybinding — Full Bubbletea Stdin Ownership — all 4 steps complete

### What Was Built

**Step 3a — Expand mode + toggle channel:**
- `expandMode bool` on `inlineRenderer`, threaded through `renderToolCompleted`, `flushPendingReads`, `completeStreamingTool`
- Shared `renderToolLine` helper for mode-aware tool rendering
- `triggerReCommit` now uses `r.expandMode` instead of hardcoded `false`
- `toggleExpandCh <-chan struct{}` on `inlineRenderConfig`, wired into event loop select
- 6 new tests

**Step 3b — Model input infrastructure:**
- New file `run_stream_inline_keypress.go` — state-based `handleKeyPress` with routing: Ctrl+O (global toggle), approval keys (arrows/enter/1-2-3/esc), text input keys (runes/backspace/enter/ctrl+c/d), idle Ctrl+C (cancel)
- New message types: `approvalStartMsg`, `approvalDecision`, `textInputStartMsg`, `textInputHideMsg`
- `newInlineBubbleModelWithChannels` constructor for channel-wired models
- `View()` updated with `textInputActive` rendering
- 32 new tests

**Step 3c — Atomic stdin transfer:**
- `startInlineProgram` removes `tea.WithInput(nil)` when channels are provided — Bubbletea now owns stdin in production TTY mode
- `toggleExpandCh` and `cancelCh` channels created in `streamAgentInline`, threaded to model and config
- `promptApprovalViaBubbletea` routes to `promptApprovalViaChannel` (new) or `promptApprovalViaKeyReader` (legacy) based on `cancelCh != nil`
- `promptFollowUpViaBubbletea` routes to `promptFollowUpViaChannel` (new) or `promptFollowUpViaKeyReader` (legacy)
- `cancelCh` case in event loop — calls `cancelExecFn` and returns "cancelled"

**Step 3d — Polish:**
- Session header mode indicator: panel title shows `"Stigmer · expanded"` when in expanded mode
- Legacy message types (`approvalShowMsg`, `approvalSelectMsg`, `followUpShowMsg`) retained with updated comments documenting fallback role
- All edge cases verified: toggle during streaming, empty history, rapid Ctrl+O, Ctrl+C during execution
- `program == nil` paths fully preserved

### Design Decisions (Phase 3)
1. **Bubbletea owns stdin in TTY mode** — single entity owns the fd, all input routes through `Update()`. Eliminates race conditions between approval prompter, follow-up scanner, and Ctrl+O listener.
2. **Channel-based decision delivery** — `approvalDecisionCh` and `textInputCh` connect the model's key handlers back to the event loop goroutine. Simple, type-safe, no shared mutable state.
3. **Legacy path retained** — `approvalShowMsg`/`approvalSelectMsg`/`followUpShowMsg` kept for the `program==nil` fallback (tests, CI, non-TTY, resumed sessions). New flow gated on `cancelCh != nil`.
4. **Non-blocking toggle send** — `handleToggleExpand` uses a buffered channel with `select`/`default` to avoid blocking the Bubbletea render loop if the event loop is busy.
5. **Ctrl+C becomes explicit** — raw mode means no OS SIGINT. Idle Ctrl+C sends on `cancelCh`; approval Ctrl+C sends `ErrSessionExit` via decision channel; text input Ctrl+C submits empty string.

### Files Created (2)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_keypress.go` — state-based key routing (117 lines)
- `client-apps/cli/cmd/stigmer/root/run_stream_inline_keypress_test.go` — 32 tests

### Files Modified (14)
- `run_stream_inline_types.go` — `expandMode`, `toggleExpandCh`, `cancelCh` fields
- `run_stream_inline_render.go` — `renderToolLine` helper, mode-aware rendering
- `run_stream_inline_history.go` — `triggerReCommit` uses `expandMode`, header mode indicator
- `run_stream_inline.go` — event loop toggle + cancel cases
- `run_stream_inline_bubbletea.go` — model fields, message handlers, `View()` text input
- `run_stream_inline_messages.go` — new message types
- `run_stream_inline_streaming.go` — `completeStreamingTool` uses `renderToolLine`
- `run_stream_inline_approval.go` — channel-based approval flow
- `run_stream_inline_followup.go` — channel-based text input flow
- `run_stream.go` — channel creation, wiring, `startInlineProgram` signature
- `run_stream_inline_bubbletea_test.go` — `startInlineProgram` call updated
- `run_stream_inline_history_test.go` — header mode indicator test, `renderToolLine` tests
- `run_stream_inline_test.go` — expand mode + toggle channel tests
- `BUILD.bazel` — new source and test files

## Previous Session Progress (2026-03-05, Session 2)

### Completed
- **T02 Phase 2**: Expanded renderers + re-commit wiring — all 4 steps complete

### What Was Built
- `RenderExpanded(tc, opts)` — routes by tool type, delegates to compact for unchanged tools
- `RenderReadGroupExpanded(reads, opts)` — shows ALL entries with no cap
- 4 internal expanded renderers: shell, think, discovery, unknown
- `expanded bool` parameter threaded through `renderCommittedItem`, `reCommitHistory`, `reCommitMsg`, `handleReCommit`
- 41 new tests + 7 expanded variants

## Previous Session Progress (2026-03-05, Session 1)

### Completed
- **T01**: Plan approved (T01_0_plan.md)
- **T02 Phase 1**: Fully implemented — all 7 steps complete

### Key Decisions Made (Phase 1)
1. History lives on `inlineRenderer`, not the Bubbletea model
2. AI content replayed to stderr during re-commit
3. Session header stays as pre-Bubbletea direct write
4. Pre-rendered text for mode-invariant items; structured data for mode-variable items
5. `sessionSubject` dead parameter replaced with `sessionHeaderInfo` struct

## Next Steps

1. **T02 Phase 4**: Follow-up history recording, resumed session Bubbletea support
2. **T02 Phase 5**: Performance profiling for long sessions
3. Future: per-tool-call expand/collapse (individual toggle, not global)
4. Future: advanced text input (cursor movement, word deletion, input history)

## Context for Resume

- Phase 3 plan: `.cursor/plans/phase_3_ctrl+o_toggle_95144a68.plan.md`
- Phase 2 plan: `.cursor/plans/phase_2_expanded_renderers_8bdf5824.plan.md`
- Phase 1 plan: `.cursor/plans/phase_1_event_history_0eda7a7b.plan.md`
- T01 plan: `_projects/2026-03/20260305.02.expand-collapse-tools/tasks/T01_0_plan.md`
- Two pre-existing test failures (`TestHandleApproval_DoesNotSuppressOnReject`, `TestInlineRenderer_ToolCompleted_ShowsBadge`) are NOT from this work — they fail on the base commit
- `go vet` passes clean; all new tests pass (40+ Phase 3 tests + all existing)
- The `program == nil` fallback paths (resumed sessions, non-TTY, CI, tests) are fully preserved. New channel-based flow is gated on `cancelCh != nil`.

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Quick Commands

After loading context:
- "Continue with Phase 4" - Resume with follow-up and resume support
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
