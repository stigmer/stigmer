# Fix Inline Rendering Resilience

**Date**: March 8, 2026

## Summary

Fixes three interrelated bugs in the CLI inline rendering pipeline that caused the terminal to go dark (no output) when the Bubbletea program died silently during terminal resize, a background channel close created a CPU spin loop, or a program restart hung indefinitely. Introduces a thin `managedProgram` lifecycle wrapper that degrades gracefully to direct writes instead of silently dropping all output.

## Problem Statement

After the split-run-resume refactoring, users reported the CLI getting stuck — the server processed events but nothing appeared on screen. Terminal resize during session startup was a reliable trigger. The root cause was three independent bugs that interacted to produce a completely frozen UI.

### Pain Points

- **Silent program death**: `p.Run()` errors were silently discarded (`_, _ = p.Run()`). When Bubbletea's inline program died (e.g., terminal resize edge case in v2), all subsequent `Println`/`Send` calls went to a dead program — no error, no output, no crash
- **Closed-channel spin loop**: `fetchRecentSessions` used `defer close(ch)`, but the `renderInline` select loop only niled the channel inside the `ok && len(sessions) > 0` guard. A closed channel with no data was never niled, creating a tight CPU spin that starved the event channel
- **Unbounded `Wait()` in `performReCommit`**: `r.cfg.program.Wait()` had no timeout. If the dying program couldn't process `Quit()`, the entire rendering pipeline froze permanently

## Solution

Rather than scatter defensive checks across 20+ `program.Println`/`program.Send` call sites, the fix introduces a single-responsibility `managedProgram` wrapper that encapsulates exactly one concern: "is the Bubbletea program still alive?" All call sites continue to use the same method signatures; the wrapper handles fallback transparently.

## Implementation Details

### New: `managedProgram` wrapper (`run_stream_inline_program.go`)

A thin struct wrapping `*tea.Program` with an `atomic.Bool` dead flag:

- `runAndMonitor()` — starts `p.Run()` in a goroutine and sets `dead=true` when Run exits (for any reason)
- `Println()` — delegates to the live program or falls back to `fmt.Fprintln` on the fallback writer
- `Send()` — delegates or no-ops when dead (transient UI messages are irrelevant in degraded mode)
- `Wait(timeout)` — waits with a deadline; marks dead if the timeout fires
- `IsAlive()` — atomic read of the dead flag

### Fix: nil-on-receive for one-shot channels

Moved `cfg.recentSessionsCh = nil` and `cfg.subjectUpdate = nil` before the `ok` check in both the main `renderInline` select loop and `drainRecommitTriggers`. This is the idiomatic Go pattern for one-shot channels in a select loop — regardless of whether data arrived or the channel was closed, the select never re-selects the case.

### Fix: bounded `Wait()` in `performReCommit`

Both `performReCommit` and `performReCommitWithApproval` now call `Wait(2 * time.Second)`. The `stopInlineProgram` cleanup function uses `Wait(5 * time.Second)`. If the timeout fires, the program is marked dead and execution continues.

## Benefits

- **No more dark terminal**: If the Bubbletea program dies, output degrades to direct writes on stderr instead of disappearing entirely
- **No CPU spin**: Closed one-shot channels are immediately niled, preventing select-loop hot spin
- **No deadlocks**: All `Wait()` calls have timeouts, preventing indefinite hangs during program restart
- **Zero call-site changes**: The wrapper's method signatures match the original `*tea.Program`, so the 20+ call sites (statusf, renderTodoUpdate, renderSubAgentStarted, etc.) required no logic changes
- **Same fallback path**: The dead-program fallback exercises the same code path that already exists for non-TTY environments (`if r.cfg.program == nil`)

## Impact

- **Users**: Terminal resize during session startup no longer freezes the CLI. If Bubbletea encounters any unexpected error, the user sees output (degraded formatting) rather than nothing
- **Developers**: The `managedProgram` abstraction is the single point of truth for program health — no need to add defensive nil/error checks at each call site
- **Tests**: 5 new unit tests cover alive/dead transitions, fallback output, and safe no-ops. Existing test suite passes without behavioral changes

## Files Changed

- **New**: `run_stream_inline_program.go` — `managedProgram` wrapper (~100 lines)
- **New**: `run_stream_inline_program_test.go` — lifecycle unit tests
- **Modified**: `run_stream_inline_types.go` — `program` field type in `inlineRenderConfig` and `renderResult`
- **Modified**: `run_stream.go` — `startInlineProgram` and `programFactory` return `*managedProgram`; `stopInlineProgram` accepts `*managedProgram` with timeout
- **Modified**: `run_stream_inline_followup.go` — function signatures updated for `*managedProgram`
- **Modified**: `resume_session.go` — `programFactory` signature change
- **Modified**: `run_stream_inline.go` — nil-on-receive for `recentSessionsCh` and `subjectUpdate`
- **Modified**: `run_stream_inline_history.go` — bounded `Wait(2s)` in both `performReCommit` variants
- **Modified**: Test files for type compatibility

## Related Work

- [Split Run and Resume Commands](2026-03-08-021252-split-run-and-resume-commands.md) — the refactoring that exposed the latent bugs
- [Fix Inline Rendering Program Restart](2026-03-07-085926-fix-inline-rendering-program-restart-recommit.md) — prior re-commit improvements
- [Bubbletea v2 Migration](2026-03-05-204550-bubbletea-v2-mechanical-api-migration.md) — the v2 upgrade that introduced inline mode

---

**Status**: ✅ Production Ready
