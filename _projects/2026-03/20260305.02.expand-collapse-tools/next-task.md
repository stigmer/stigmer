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
**Current Task**: T02 — All phases complete + post-phase fix
**Status**: Feature complete (Phases 1-5 done, duplicate header fix applied)
**Last Session**: 2026-03-05 (Session 6)

## Session Progress (2026-03-05, Session 6)

### Completed
- **Fix duplicate session header on subject update** — eliminated dual-write architecture

### What Was Done

**Root Cause**: The session header was written directly to stderr by the caller (`renderSessionHeader(os.Stderr, ...)`) before Bubbletea started, and then the re-commit mechanism (`ClearScreen + Println`) tried to render it again when the subject arrived. Since terminal scrollback is immutable once content scrolls out of the viewport, both headers remained visible.

**Fix — Single-source header via Bubbletea:**
- Removed caller-side `renderSessionHeader` from inline rendering path in `run_agent_exec.go` and `run_session.go`
- `renderInline` now prints the header at startup via `statusf` (routes through Bubbletea's `Println`) for new sessions
- JSON and detach modes still render headers via `renderSessionHeader` in their own code paths
- Existing `triggerReCommit()` on subject arrival works correctly since the header is now within Bubbletea's line tracking

**Spacing fix:**
- `renderHistoryBatch` now adds an extra `\n` after `kindHeader` items, producing a consistent blank-line gap between the header panel and the first content item
- Matches the initial render spacing (`statusf(header)` + `statusf("")`)

**Tests:**
- Updated `TestRenderHistoryBatch_MatchesPerItemOutput` for new header spacing
- Added `TestRenderHistoryBatch_HeaderHasBlankLineGap`
- Added `TestRenderHistoryBatch_HeaderOnly_NoExtraNewline`
- All tests pass, benchmarks unchanged

### Files Modified (7)
- `run_agent_exec.go` — moved `renderSessionHeader` inside `if input.Detach`
- `run_session.go` — removed unconditional `renderSessionHeader` from `openSession`; added to JSON branch of `resumeSession`
- `run_stream.go` — added `renderSessionHeader` to JSON branch of `streamAgentExecution`
- `run_stream_inline.go` — render header at startup via `statusf` for new sessions
- `run_stream_inline_history.go` — extra `\n` after header in `renderHistoryBatch`; updated doc comments
- `run_stream_inline_history_test.go` — 2 new tests, 1 updated test
- `run_stream_inline_types.go` — updated doc comment removing "direct stderr write" reference

### Design Decisions (Session 6)
1. **Session header key decision #3 revised** — Phase 1 chose "Session header stays as pre-Bubbletea direct write." This session reverses that decision: the header now renders exclusively through Bubbletea for inline mode. The old approach caused duplicate headers that couldn't be erased from scrollback.

## Previous Session Progress (2026-03-05, Session 5)

### Completed
- **T02 Phase 5**: Re-commit Performance Optimization — all 4 steps complete

### What Was Built

**Step 5a — Benchmarks:**
- New file `run_stream_inline_history_bench_test.go` — first benchmark file in the CLI codebase
- 7 per-kind benchmarks (`renderCommittedItem` for header, tool compact/expanded, read group compact/expanded, approval, text)
- 8 batch benchmarks (`renderHistoryBatch` at 10/50/100/500 items in compact and expanded modes)
- Allocation benchmarks with `b.ReportAllocs()`

**Step 5b — Batch optimization:**
- New `renderHistoryBatch` function — renders all history items into a single string using `strings.Builder`, joining with `\n`
- `triggerReCommit` now pre-renders the full history into a string instead of copying a snapshot of items
- `reCommitMsg` simplified from 3 fields (`items []committedItem`, `compactOpts`, `expanded bool`) to 1 field (`rendered string`)
- `handleReCommit` now calls `buildReCommitCmd(msg.rendered)` — thin passthrough
- Removed `reCommitHistory` function (the N-Println builder)
- Removed unused `toolrender` import from messages file

**Step 5c — Correctness tests:**
- `TestRenderHistoryBatch_MatchesPerItemOutput` — byte-for-byte equivalence between batched and per-item rendering for both compact and expanded modes with a realistic mixed history (12 items, all kinds)
- `TestRenderHistoryBatch_EmptyHistory` — nil and empty slice
- `TestRenderHistoryBatch_SingleItem` — single item round-trip
- `TestRenderHistoryBatch_SkipsEmptyItems` — empty items (nil toolCalls) omitted
- `TestRenderHistoryBatch_NilHeader` — nil header gracefully handled
- Updated 3 existing tests from `reCommitHistory` to new `buildReCommitCmd` API

**Step 5d — Validation:**
- `go vet` passes clean
- All new and modified tests pass
- Two pre-existing failures remain (unchanged from Phase 4)
- Benchmark results: 500 items renders in ~1.9ms compact, ~2.0ms expanded (well under 500ms target)

### Design Decisions (Phase 5)
1. **Pre-render in renderer, not model** — the renderer owns both history AND rendering. The model is a thin command relay. Cleaner separation of concerns.
2. **Single Println replaces N Println calls** — reduces N+1 event-loop round-trips and terminal writes to 2. Eliminates visible flicker on Ctrl+O toggle.
3. **Snapshot copy removed** — pre-rendering to an immutable string eliminates the need to copy the history slice. Avoids shared-pointer questions (e.g., `header *sessionHeaderInfo`).
4. **Terminal resize re-commit deferred** — mode-invariant items store pre-rendered text at the original terminal width. Resize re-commit would partially reflow, creating an inconsistent visual. Proper resize support requires storing raw content for all items.

### Benchmark Results (Apple M1 Ultra)

| History size | Compact | Expanded |
|---|---|---|
| 10 items | 79us | 72us |
| 50 items | 223us | 238us |
| 100 items | 416us | 439us |
| 500 items | 1.9ms | 2.0ms |

### Files Created (1)
- `run_stream_inline_history_bench_test.go` — 225 lines, 15 benchmark functions

### Files Modified (5)
- `run_stream_inline_history.go` — added `renderHistoryBatch`, replaced `triggerReCommit` and `reCommitHistory` with `buildReCommitCmd`
- `run_stream_inline_messages.go` — simplified `reCommitMsg` to single `rendered string` field, removed `toolrender` import
- `run_stream_inline_bubbletea.go` — `handleReCommit` uses `buildReCommitCmd`
- `run_stream_inline_history_test.go` — 5 new correctness tests, 3 updated existing tests
- `BUILD.bazel` — registered new benchmark test file

## Previous Session Progress (2026-03-05, Session 4)

### Completed
- **T02 Phase 4**: Follow-up History Recording + Resumed Session Bubbletea Support — all 4 steps complete

### What Was Built

**Step 4a — Streaming tool history gap fix:**
- `completeStreamingTool` now records `kindToolCompact` in `r.history` before clearing streaming state
- Fixes the bug where shell tools streaming post-approval output disappeared on Ctrl+O toggle
- 2 new tests

**Step 4b — History persistence across follow-ups:**
- `renderInline` signature changed to return `(phase, exitErr string, history []committedItem)`
- New `initialHistory []committedItem` field on `inlineRenderConfig`
- `runInlineFollowUpLoop` captures history, appends follow-up human messages, passes accumulated history to next `renderInline` call
- Combined with `suppressHumanEcho`, prevents duplicate human messages
- 4 new tests + 4 call site updates

**Step 4c — Bubbletea for resumed sessions:**
- `resumeSession` now creates `toggleExpandCh`, `cancelCh`, and a Bubbletea program
- Users resuming a session get full Ctrl+O toggle and Ctrl+C support
- Mirrors the pattern from `streamAgentInline`

**Step 4d — Documentation:**
- Known limitation documented: `design-decisions/ctrl-o-during-follow-up-prompt.md`
- Ctrl+O during follow-up prompt is deferred (buffered, not lost)

### Design Decisions (Phase 4)
1. **Explicit history return** — history is an output of `renderInline`, not smuggled through the config struct. Cleaner data flow, testable.
2. **Follow-up message recorded by loop** — the loop owns the boundary between executions and records the human message there. The renderer's `suppressHumanEcho` prevents duplicates.
3. **Ctrl+O-during-prompt deferred** — the toggle is buffered and processed when the next execution starts. Fixing this requires restructuring the renderer/model boundary.

## Previous Session Progress (2026-03-05, Session 3)

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
3. ~~Session header stays as pre-Bubbletea direct write~~ — **Revised in Session 6**: header now renders exclusively through Bubbletea for inline mode (fixes duplicate headers)
4. Pre-rendered text for mode-invariant items; structured data for mode-variable items
5. `sessionSubject` dead parameter replaced with `sessionHeaderInfo` struct

## Next Steps

All 5 phases of T02 are complete. Remaining future work:

1. Future: per-tool-call expand/collapse (individual toggle, not global)
2. Future: Ctrl+O during follow-up prompt (deferred from Phase 4)
3. Future: advanced text input (cursor movement, word deletion, input history)
4. Future: terminal resize re-commit (requires storing raw content for all items)

## Context for Resume

- Phase 5 plan: `.cursor/plans/phase_5_performance_71c4c48f.plan.md`
- Phase 4 plan: `.cursor/plans/phase_4_follow-up_and_resume_d7dfc0e4.plan.md`
- Phase 3 plan: `.cursor/plans/phase_3_ctrl+o_toggle_95144a68.plan.md`
- Phase 2 plan: `.cursor/plans/phase_2_expanded_renderers_8bdf5824.plan.md`
- Phase 1 plan: `.cursor/plans/phase_1_event_history_0eda7a7b.plan.md`
- T01 plan: `_projects/2026-03/20260305.02.expand-collapse-tools/tasks/T01_0_plan.md`
- Known limitation: `design-decisions/ctrl-o-during-follow-up-prompt.md`
- Two pre-existing test failures (`TestHandleApproval_DoesNotSuppressOnReject`, `TestInlineRenderer_ToolCompleted_ShowsBadge`) are NOT from this work — they fail on the base commit
- `go vet` passes clean; all new tests pass
- Benchmark results show ~2ms for 500-item re-commit (well under 500ms target)

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
- "Continue with Phase 5" - Resume with performance profiling
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
