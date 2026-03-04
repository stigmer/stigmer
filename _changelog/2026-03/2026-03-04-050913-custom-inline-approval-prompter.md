# Custom Inline Approval Prompter

**Date**: March 4, 2026

## Summary

Added a new `InlinePrompter` to `pkg/approval/` that replaces Bubbletea for inline-mode approval prompts. The prompter uses raw terminal mode for precise keystroke control and reports exact rendered line count, enabling the cursor-controlled collapse flow planned for Phase 3.2-3.3.

## Problem Statement

The existing `InteractivePrompter` delegates to Bubbletea's `tea.NewProgram`, which owns the render loop and makes line counting opaque. The inline CLI renderer needs to know the exact number of terminal rows the prompt occupied in order to erase it (via `termctl.EraseLines`) and replace it with a compact summary after the user decides.

### Pain Points

- Bubbletea controls rendering on its own schedule — no way to get an exact line count
- The inline renderer's cursor-collapse flow (Phase 3.2-3.3) requires precise row accounting
- Bubbletea is a full TUI framework — overkill for a 3-option selection menu

## Solution

Built a standalone `InlinePrompter` component with two files following SRP:

- **`keyread.go`** — Byte-to-keycode decoding with a persistent reader goroutine and escape sequence parsing
- **`inline_prompter.go`** — Prompt orchestration: raw mode lifecycle, menu rendering, keystroke loop, line count reporting

## Implementation Details

**keyReader** runs a persistent goroutine that reads one byte at a time from the `io.Reader` and delivers them via a buffered channel. Escape sequences (arrow keys: `\033[A`, `\033[B`) are disambiguated from standalone Esc using a 50ms timeout. A priority-select pattern in `readByte` ensures buffered bytes are always consumed before EOF errors — preventing a race condition where Go's random channel selection could pick an error over a valid byte.

**InlinePrompter** accepts `io.Reader` + `io.Writer` (DI-compliant, no `os.Stdin` references). It implements the `Prompter` interface (drop-in replacement) and exposes `PromptWithLineCount` for Phase 3.3 cursor integration. The menu is a 4-line vertical compact layout: 3 options (Yes/Skip/Reject) + 1 hint line. Menu re-rendering on arrow key navigation uses `termctl.EraseLines`. Stale input is drained before each prompt to prevent buffered keystrokes from auto-selecting.

## Benefits

- Exact line count reporting enables cursor-controlled erase+replace after approval decisions
- DI-compliant design (io.Reader/io.Writer) — fully testable without a real terminal
- Drop-in `Prompter` interface compatibility — existing call sites work unchanged
- 30 test functions covering rendering, key sequences, edge cases, and non-interactive paths
- Two-file SRP split keeps each file within coding guidelines (178 and 164 lines)

## Impact

- **Phase 3.2-3.3**: `PromptWithLineCount` provides the line count needed for cursor collapse
- **Existing code**: Zero changes to `run_stream_inline.go` or `handleApproval` (integration is Phase 3.3)
- **TUI mode**: `InteractivePrompter` retained for Bubbletea TUI path — no regression

## Related Work

- Phase 3.0: Terminal cursor control primitives (`pkg/termctl/`) — foundation used by `InlinePrompter` for menu re-rendering
- Phase 3.2: Four-state tool rendering — will consume `PromptWithLineCount` for collapse
- Phase 3.3: `handleApproval` rewrite — will wire `InlinePrompter` into the inline renderer

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
