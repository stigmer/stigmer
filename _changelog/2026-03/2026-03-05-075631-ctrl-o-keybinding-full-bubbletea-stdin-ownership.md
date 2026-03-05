# Ctrl+O Keybinding — Full Bubbletea Stdin Ownership

**Date**: March 5, 2026

## Summary

Transferred stdin ownership from scattered direct readers to Bubbletea's unified input loop, enabling the Ctrl+O expand/collapse toggle and establishing a clean architecture for all future keyboard interactions. The approval flow and follow-up text input now communicate with the event loop via typed Go channels instead of reading `os.Stdin` directly.

## Problem Statement

The inline renderer needed a way for users to toggle between compact and expanded views of tool call output (similar to Claude Code's Ctrl+O). However, stdin was consumed by three separate, conflicting readers:

### Pain Points

- `approval.InlinePrompter.PromptKeyOnly` read `os.Stdin` in raw mode via a `keyReader` goroutine
- `readStdinLine` read `os.Stdin` in cooked mode via `bufio.Scanner` for follow-up prompts
- Any new Ctrl+O listener would be a third concurrent reader — a race condition
- `tea.WithInput(nil)` prevented Bubbletea from reading stdin at all, forcing input through external mechanisms
- No single entity owned the terminal's input fd, making it impossible to add global keybindings

## Solution

Unified all stdin reading under Bubbletea's input loop. When running on a TTY, `tea.WithInput(nil)` is removed so Bubbletea puts the terminal in raw mode and delivers all keystrokes as `tea.KeyMsg` in `Update()`. Approval navigation and follow-up text input are now model-driven, communicating decisions back to the event loop goroutine via typed channels.

## Implementation Details

### Architecture: Channel-Based Communication

The core pattern is a channel bridge between two goroutines:

1. **Event loop goroutine** — creates a channel, sends a message to the Bubbletea program with the channel, then blocks waiting for a response
2. **Bubbletea render loop** — receives the message, stores the channel, routes keystrokes to it based on UI state, delivers the result

This pattern is used for both approval decisions (`chan approvalDecision`) and follow-up text input (`chan string`). The `toggleExpandCh` and `cancelCh` use the reverse direction (model → event loop) with non-blocking sends.

### State-Based Key Routing

`handleKeyPress` routes keystrokes based on the model's current UI state:

- **Always**: Ctrl+O → non-blocking send on `toggleExpandCh`
- **Approval active**: arrows/enter/1-2-3 → menu navigation and decision delivery; esc/ctrl+c → `ErrSessionExit`
- **Text input active**: runes/space → append to buffer; backspace → remove last rune; enter → submit; ctrl+c/d → submit empty
- **Idle**: Ctrl+C → non-blocking send on `cancelCh`

### Expand Mode Threading

`expandMode` on `inlineRenderer` is flipped when the event loop receives on `toggleExpandCh`. The mode is threaded through:

- `renderToolCompleted` and `flushPendingReads` — new items render in current mode
- `completeStreamingTool` — post-streaming completion uses current mode
- `triggerReCommit` — re-committed history uses current mode
- Session header panel — title shows `"Stigmer · expanded"` when active

### Legacy Path Preservation

The `program == nil` fallback (resumed sessions, non-TTY, CI, tests) is fully preserved. New channel-based flows are gated on `cancelCh != nil`. Legacy message types (`approvalShowMsg`, `approvalSelectMsg`, `followUpShowMsg`) are retained with updated documentation.

### Key Files

| File | Change |
|------|--------|
| `run_stream_inline_keypress.go` | NEW — state-based key routing (117 lines) |
| `run_stream_inline_types.go` | `expandMode`, `toggleExpandCh`, `cancelCh` fields |
| `run_stream_inline_bubbletea.go` | Model fields, channel-wired constructor, new message handlers |
| `run_stream_inline_messages.go` | `approvalStartMsg`, `approvalDecision`, `textInputStartMsg`, `textInputHideMsg` |
| `run_stream_inline_approval.go` | `promptApprovalViaChannel` + `promptApprovalViaKeyReader` split |
| `run_stream_inline_followup.go` | `promptFollowUpViaChannel` + `promptFollowUpViaKeyReader` split |
| `run_stream.go` | Channel creation, wiring, `startInlineProgram` signature |
| `run_stream_inline_render.go` | `renderToolLine` shared helper |
| `run_stream_inline_history.go` | `triggerReCommit` uses `expandMode`, header mode indicator |
| `run_stream_inline.go` | Event loop toggle + cancel cases |

## Benefits

- **Ctrl+O expand/collapse toggle** — users can now press Ctrl+O at any time to switch between compact and expanded views of all tool call output
- **No stdin race conditions** — single owner eliminates the possibility of two goroutines reading the same fd
- **Foundation for future keybindings** — any new shortcut (Ctrl+P for pause, Ctrl+R for rerun, etc.) is a simple addition to `handleKeyPress`
- **Cleaner approval architecture** — the channel-based approval flow is simpler than the external `keyReader` goroutine + `approvalSelectMsg` relay
- **Text input via model** — follow-up prompts show typed characters in real-time via `View()` instead of relying on the terminal's cooked-mode echo

## Impact

- **End users**: Can toggle tool output verbosity with Ctrl+O during any phase of agent execution
- **Developers**: Clear pattern for adding keyboard shortcuts — route in `handleKeyPress`, communicate via channel
- **Architecture**: Stdin ownership is now settled — Bubbletea owns it in TTY mode, external readers own it in non-TTY mode
- **Testing**: 40+ new unit tests covering all key routing states and channel communication patterns

## Related Work

- [Event History Retention and Subject Update](2026-03-05-070144-event-history-retention-and-subject-update.md) — Phase 1: history storage and clear+re-commit mechanism
- [Expanded Renderers for Tool Call Toggle](2026-03-05-071808-expanded-renderers-for-tool-call-toggle.md) — Phase 2: `RenderExpanded` and `RenderReadGroupExpanded`
- [Bubbletea Inline Renderer Foundation](2026-03-05-033212-bubbletea-inline-renderer-phase-1-foundation.md) — original Bubbletea migration

---

**Status**: ✅ Production Ready
**Timeline**: T02 Phase 3 (4 incremental steps)
