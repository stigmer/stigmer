# Phase 2: Thinking Spinner Migration to Bubbletea View()

**Date**: March 5, 2026

## Summary

Moved the inline renderer's thinking spinner from a goroutine-based `pkg/spinner.Spinner` with raw ANSI escape sequences (`\r\033[K`) into Bubbletea's `Update()`/`View()` cycle using `tea.Tick` Cmds. This is the first phase where Bubbletea's `View()` renders actual content, proving the framework integration pattern for all subsequent migration phases.

## Problem Statement

The thinking spinner (the `Thinking... (3s)` indicator that appears during agent idle periods) was rendered by a standalone goroutine that wrote `\r` (carriage return) escape sequences directly to stderr. This bypassed Bubbletea's row tracking, meaning Bubbletea had no awareness of the spinner line's existence.

### Pain Points

- Raw `\r\033[K` writes to stderr that Bubbletea cannot track
- Goroutine-based animation independent of Bubbletea's render cycle
- Synchronous `Stop()` semantics that don't compose well with Bubbletea's async model
- First render element that needed to move into `View()` to prove the Phase 1 foundation works

## Solution

Replaced the goroutine-based spinner with Bubbletea's idiomatic `tea.Tick` Cmd pattern. The inline renderer's event loop retains the 2-second idle timer decision logic; it communicates start/stop to Bubbletea via `program.Send()`. The model's `Update()` manages a self-propagating 80ms tick chain, and `View()` renders the spinner frame.

## Implementation Details

### Bubbletea tick chain pattern

The spinner uses a self-propagating tick chain: `spinnerStartMsg` triggers the first `tea.Tick(80ms, ...)`, each `spinnerTickMsg` advances the frame counter and returns the next tick, and `spinnerStopMsg` sets `active=false` so the next tick returns `nil` (terminating the chain).

### Exported spinner constants

`pkg/spinner` now exports `Frames`, `FrameInterval`, and `FormatElapsed` so the Bubbletea model produces visually identical output without duplicating constants. The `Spinner` type and all its methods remain for the workflow execution path.

### Async stop safety

`program.Send()` is async unlike the former synchronous `spinner.Stop()`. This is safe because all subsequent status output also goes through `program.Println()` (also async), preserving ordering within Bubbletea's render cycle. The approval flow edge case is not affected -- preceding events always reset the idle timer before an `ApprovalNeededEvent` arrives.

### Files changed

| File | Change |
|------|--------|
| `pkg/spinner/spinner.go` | Export `Frames`, `FrameInterval`, `FormatElapsed` |
| `pkg/spinner/spinner_test.go` | Update references to exported names |
| `run_stream_inline_bubbletea.go` | Add spinner state, messages, Update handlers, View rendering |
| `run_stream_inline_spinner.go` | Route start/stop through `program.Send()` |
| `run_stream_inline.go` | Remove `spinner` field and `spinner.New()` |
| `run_stream_inline_bubbletea_test.go` | 8 new spinner model tests |
| `run_stream_inline_spinner_test.go` | Updated scaffolding, new no-program test |

## Benefits

- Zero raw ANSI escape sequences in the inline renderer's spinner path
- Bubbletea now tracks all spinner rows, eliminating cursor drift risk
- Proves the `View()` rendering pattern that Phase 3 (header) and Phase 4 (approval) will follow
- Non-TTY path unchanged: no spinner in CI/piped environments

## Impact

- 7 files changed, 258 insertions, 52 deletions
- All spinner/bubbletea tests pass (18 tests)
- Workflow execution spinner (`run_stream.go`) completely unaffected
- Visual output identical: same braille frames, same 80ms interval, same elapsed time format

## Related Work

- Phase 1: Bubbletea Program Shell (`0f9dfcf1`) -- established the foundation
- Design Decision 001: Conservative Bubbletea Integration -- informed the async approach
- Next: Phase 3 (Subject/Header Update) and Phase 4 (Approval Flow Migration)

---

**Status**: Production Ready
**Timeline**: Single session
