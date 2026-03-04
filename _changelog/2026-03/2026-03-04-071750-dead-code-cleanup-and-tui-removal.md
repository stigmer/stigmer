# Dead Code Cleanup and Alt-Screen TUI Removal

**Date**: March 4, 2026

## Summary

Comprehensive dead code cleanup removing the entire alt-screen TUI implementation (~7,400 lines deleted) and dead exports across multiple CLI packages. This eliminates a significant source of maintenance burden and technical debt now that the inline-first rendering architecture is fully operational.

## Problem Statement

The CLI underwent a major architectural shift from an alt-screen Bubbletea TUI to an inline scrollback-friendly renderer across Phases 1-4. While the inline renderer was fully functional and set as the default, the old TUI code remained in the codebase — unreachable but still imposing maintenance cost.

### Pain Points

- `executiontui` package contained ~5,700 lines of alt-screen TUI code (model, update, view, blocks, scroll, focus, help, approval rendering) that was completely unreachable after Phase 1 flipped the default to inline-only
- `run_tui.go` and `streamAgentInteractive`/`resumeSessionInteractive` formed a dead execution path that would never be invoked
- `OutputInteractive` enum value existed but was never assigned by `resolveOutputMode`
- Multiple exported functions in `toolrender`, `termctl`, `display`, and `cliprint` had zero callers
- Dead code imposed false confidence — it compiled but was never tested against the evolving event system, meaning it would likely be broken if ever re-enabled

## Solution

Systematic identification and removal of all dead code paths, organized into sub-phases with compile and test verification at each boundary:

1. **TUI path from root package** — delete entry points and unreachable switch branches
2. **TUI implementation from executiontui** — excise 18 files, retain shared event types
3. **Dead exports across packages** — remove unused functions confirmed via caller analysis
4. **Overlap assessment** — evaluate `display.GetTerminalWidth` vs `termctl.Width` (retained both due to differing semantics)

## Implementation Details

### Phase 5.1: Root Package TUI Path Removal

- Deleted `run_tui.go` (80 lines) and `run_tui_test.go` (178 lines)
- Removed `streamAgentInteractive` from `run_stream.go` and `resumeSessionInteractive` from `run_session.go`
- Removed `OutputInteractive` constant from `output_mode.go` — iota renumbered, safe because values are never serialized
- Made `OutputInline` the `default` switch branch, `OutputJSON` the only explicit case
- Removed `tea` (Bubbletea) dependency from root `BUILD.bazel`

### Phase 5.2: executiontui Package Reduction

Deleted 13 source files and 5 test files:

| Deleted Source Files | Deleted Test Files |
|---|---|
| `model.go`, `update.go`, `view.go` | `update_test.go` |
| `handle_events.go`, `messages.go` | `render_blocks_test.go` |
| `blocks.go`, `render_blocks.go` | `approval_test.go` |
| `render_approval.go`, `approval.go` | `help_test.go` |
| `help.go`, `input.go` | `scroll_test.go` |
| `focus.go`, `scroll.go` | |

Retained 3 files forming the package's new role as a pure event/type definition layer:

- `events.go` — renderer-agnostic event types (`Event`, `EventToolStarted`, etc.)
- `followup.go` — shared `FollowUpFn` and `FollowUpResult` types
- `doc.go` — rewritten package documentation

Rewrote `BUILD.bazel` to remove all Bubbletea, Bubbles, and Lipgloss dependencies.

### Phase 5.3: Dead Export Removal

**toolrender** (6 functions removed):
- `DisplayLabel`, `HasDisplayableContent`, `RenderRunning`, `RenderWaitingApproval`, `RenderExpanded`, `RenderExpandedWithBadge`
- `RenderResultWithPreview` confirmed alive via `run_display_stream.go`

**termctl** (3 functions removed):
- `MoveUp`, `ClearDown`, `ClearLine` — speculative functions with zero callers; `EraseLines` retained (active)

**display** (1 file removed):
- Entire `table.go` (~200 lines) — `ApplyResultTable` and helpers with no callers

**cliprint** (1 constant removed):
- `PhaseReady` — unused phase constant

### Phase 5.4: Overlap Assessment

Evaluated `display.GetTerminalWidth()` vs `termctl.Width()`:
- `display.GetTerminalWidth` clamps to `MinTermWidth` (60) and hardcodes stdout — used by table rendering code
- `termctl.Width` takes an `io.Writer` and returns raw width — used by inline renderer
- Different semantics justified retaining both; no migration performed

## Benefits

- **~7,400 lines removed** (237 added for documentation/next-task updates, 7,662 deleted)
- **18 source + 5 test files deleted** from `executiontui` alone
- **Zero Bubbletea dependency in root command package** and `executiontui`
- **Cleaner public API surfaces** across `toolrender`, `termctl`, `display`, `cliprint`
- **Reduced cognitive load** — developers exploring the codebase won't encounter dead TUI code
- **Eliminated false confidence** — dead code that compiled but would silently break if re-enabled

## Impact

- **Maintainers**: Significantly reduced surface area to understand and maintain
- **Build times**: Fewer files to compile, fewer dependencies to resolve
- **New contributors**: Clearer package purposes — `executiontui` is now obviously an event/type package, not a TUI framework
- **Future work**: Clean foundation for inline renderer enhancements without legacy code interference

## Related Work

- [Phase 1: Proto Schema & Inline Default](2026-03-04-005215-multi-source-workspace-proto-schema.md)
- [Phase 2: Compact Rendering Pipeline](2026-03-04-013241-compact-read-tool-rendering.md)
- [Phase 3: Terminal Control & Approval Flow](2026-03-04-044751-terminal-cursor-control-primitives.md)
- [Phase 4: Thinking Spinner & Follow-Up](2026-03-04-065111-thinking-spinner-and-follow-up-input.md)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
