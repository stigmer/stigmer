# Bubbletea Inline Renderer -- Phase 1 Foundation

**Date**: March 5, 2026

## Summary

Established the Bubbletea `tea.Program` infrastructure alongside the existing inline renderer, proving coexistence and routing stderr status output through `Program.Println` for framework-managed row tracking. This is the foundation for a 7-phase migration that will eliminate all manual ANSI cursor math (`lineCountingWriter`, `termctl.EraseLines`, raw escape sequences) from the CLI's inline rendering pipeline.

## Problem Statement

The Stigmer CLI inline renderer relies on manual ANSI cursor manipulation for in-place terminal updates (subject replacement, approval collapse, tool streaming erasure, follow-up prompt erasure). A `lineCountingWriter` counts `\n` bytes, but terminal soft-wrapping introduces display rows without `\n`, causing the counter to drift. Every cursor-back operation using this counter can hit the wrong row when content exceeds terminal width.

### Pain Points

- `lineCountingWriter` counts newlines, not display rows -- drifts on soft wrap
- 6 `termctl.EraseLines` call sites in approval, 2 in streaming, 1 in follow-up
- Raw `\033[s`/`\033[u`/`\033[NA`/`\033[2K` sequences in subject updater
- Spinner uses `\r\033[K` in its own goroutine
- All cursor math assumes content fits within terminal width

## Solution

Introduce a Bubbletea `tea.Program` running in inline mode (no alt screen) alongside the existing event loop. The Program owns the stderr writer via `tea.WithOutput(statusW)` and tracks row positions accurately. Status output is routed through `Program.Println` which feeds Bubbletea's internal `queuedMessageLines` queue, flushed on the renderer's 60fps tick. AI content continues going directly to stdout (Println is line-based and cannot support token-by-token streaming).

## Implementation Details

### Architectural discoveries during planning

Three constraints revised the original T01 plan:

1. **tea.Println is line-based** -- always appends `\r\n`, ruling out AI streaming through Bubbletea
2. **Update() cannot block** -- the approval flow blocks for raw terminal input, so the event loop cannot move into Bubbletea's Update cycle until Phase 4
3. **stdout/stderr split is the natural boundary** -- `tea.WithOutput(os.Stderr)` + `tea.WithInput(nil)` lets Bubbletea own stderr while stdin and stdout remain untouched

### New file: `run_stream_inline_bubbletea.go`

Defines `inlineBubbleModel` implementing `tea.Model`:
- `Init()` returns nil
- `Update()` is a pass-through (returns model unchanged)
- `View()` returns "" (no active region -- subsequent phases will progressively populate this)

### Modified: `run_stream.go`

- `startInlineProgram(statusW)` creates the Program with `tea.WithOutput(statusW)` and `tea.WithInput(nil)`, starts `p.Run()` in a goroutine. Returns nil for non-TTY writers (CI, piped output).
- `stopInlineProgram(p)` sends Quit and waits for exit. Nil-safe.
- `streamAgentInline` creates the Program before the render loop, passes it into `inlineRenderConfig`, and stops it on return.

### Modified: `run_stream_inline.go`

- `inlineRenderConfig` gains a `program *tea.Program` field (nil in tests = fallback)
- `inlineRenderer` gains an `inApprovalFlow bool` sentinel
- `statusf()` routes through `program.Println()` when program is non-nil and not in the approval flow, trimming the trailing newline. Falls back to direct write when program is nil or during approval.
- The sentinel is set before the pre-switch `flushPendingReads` for `ApprovalNeededEvent` and cleared after `handleApproval` returns, ensuring all approval-adjacent writes bypass Bubbletea's async render queue.

### New file: `run_stream_inline_bubbletea_test.go`

9 tests covering:
- Model interface (Init, Update, View)
- Program lifecycle (nil for non-TTY, safe nil stop)
- statusf routing (direct write without program, direct write during approval, Println with real Program, ordering verification)

## Benefits

- **Row tracking foundation**: Bubbletea now tracks all stderr output positions, enabling future phases to use `View()` for in-place re-rendering without manual cursor math
- **Zero UX regression**: All existing tests pass unchanged; output is visually identical
- **Clean separation**: AI content (stdout) stays direct, status content (stderr) flows through Bubbletea -- matching the existing piping design
- **Incremental migration path**: Subsequent phases (spinner, header, approval, streaming, follow-up) each move one rendering component into `View()`, building on this foundation

## Impact

- **CLI inline renderer**: All status output now flows through Bubbletea's render pipeline when running in a terminal
- **Tests**: Unaffected -- nil program triggers direct-write fallback
- **CI/piped output**: Unaffected -- `startInlineProgram` returns nil for non-TTY
- **JSON mode**: Untouched (separate code path)

## Related Work

- T01 Architecture Plan: `_projects/2026-03/20260305.01.bubbletea-inline-renderer/tasks/T01_0_plan.md`
- Phase 1 Implementation Plan: `.cursor/plans/phase_1_bubbletea_shell_66a949e3.plan.md`
- Approval collapse fix: `_changelog/2026-03/2026-03-05-020724-fix-approval-collapse-deterministic-erasure.md`
- Terminal cursor control primitives: `_changelog/2026-03/2026-03-04-044751-terminal-cursor-control-primitives.md`

---

**Status**: Production Ready
**Timeline**: Phase 1 of 7 in the Bubbletea inline renderer migration
