# Follow-up History Recording + Resumed Session Bubbletea Support

**Date**: March 5, 2026

## Summary

Phase 4 of the expand/collapse project closes three gaps that prevented Ctrl+O from working correctly in multi-execution sessions and resumed sessions. History now accumulates across follow-up executions, streaming tool completions are recorded, and resumed sessions have full Bubbletea support (Ctrl+O toggle, Ctrl+C cancel, channel-based prompts).

## Problem Statement

After Phase 3 delivered Ctrl+O expand/collapse for single-execution sessions, three gaps remained:

### Pain Points

- **Streaming tool history gap**: Shell tools that streamed post-approval output via `completeStreamingTool` were never recorded in `r.history`. Pressing Ctrl+O after such a tool caused it to vanish from the screen.
- **History lost across follow-ups**: Each `renderInline` call created a fresh history buffer `[{kindHeader}]`. In a multi-follow-up session, pressing Ctrl+O after follow-up 2 only re-rendered items from the current execution — everything from follow-up 1 disappeared.
- **No Bubbletea for resumed sessions**: `resumeSession` built its `inlineRenderConfig` without a Bubbletea program, `toggleExpandCh`, or `cancelCh`. Users who opened a completed session got no Ctrl+O, no Ctrl+C during idle, and the follow-up prompt fell back to direct stdin reads instead of channel-based input.

## Solution

Three independent, isolated fixes that build on each other:

1. **Record streaming tool completions in history** before clearing streaming state.
2. **Thread history explicitly** through `renderInline` and the follow-up loop: `renderInline` returns its accumulated history, the loop appends the follow-up human message, and passes everything to the next `renderInline` via `initialHistory`.
3. **Wire Bubbletea into `resumeSession`** by mirroring the TTY detection, channel creation, and program lifecycle from `streamAgentInline`.

## Implementation Details

### Streaming tool history fix (`run_stream_inline_streaming.go`)

`completeStreamingTool` now captures `r.streamSubAgentID` before it's cleared, then appends a `kindToolCompact` item to `r.history` before calling `clearStreamingState()`. Both the Bubbletea and direct-write paths share the recording logic — the early return was refactored into an if/else.

### History persistence (`run_stream_inline.go`, `run_stream_inline_types.go`, `run_stream_inline_followup.go`)

- `renderInline` signature: `(phase, exitErr string)` → `(phase string, exitErr string, history []committedItem)`. All five return paths return `r.history`.
- New `initialHistory []committedItem` field on `inlineRenderConfig`. When non-nil, the renderer uses it instead of creating a fresh header-only buffer.
- `runInlineFollowUpLoop` captures the returned history, appends the follow-up human message as `kindHumanMessage`, and sets `cfg.initialHistory` before the next iteration. Combined with `suppressHumanEcho = true`, the backend's echo of the human message is suppressed and not double-recorded.

### Bubbletea for resumed sessions (`run_session.go`)

`resumeSession` now creates `toggleExpandCh` and `cancelCh` when stderr is a TTY (via `termctl.IsSupported`), starts a Bubbletea program via `startInlineProgram`, passes all three to `inlineRenderConfig`, and calls `stopInlineProgram` after the follow-up loop returns. This mirrors the exact pattern from `streamAgentInline`.

### Known limitation documented

Ctrl+O pressed during the follow-up prompt (between executions) does not toggle immediately — the signal is buffered and processed when the next `renderInline` starts. Root cause: the event loop isn't running during `promptFollowUp`. Documented in `design-decisions/ctrl-o-during-follow-up-prompt.md` for future consideration.

## Benefits

- **Full conversation toggle**: Ctrl+O now replays the entire session history across all follow-up executions, not just the current one. The user sees a consistent view of their whole conversation.
- **Streaming tools visible on toggle**: Shell tools that stream output post-approval are no longer invisible after Ctrl+O.
- **Parity for resumed sessions**: Users who resume a completed session (`stigmer run ses-xxx`) get the same interactive experience as a fresh session — Ctrl+O, Ctrl+C, and channel-based prompts all work.

## Impact

- **End users**: Consistent Ctrl+O behavior regardless of session age or follow-up count. Resumed sessions are now first-class interactive citizens.
- **Codebase**: 330 lines added across 9 files (5 production, 4 test). Clean data flow with explicit history return — no mutable state smuggled through config.
- **Test coverage**: 8 new tests covering streaming tool history, initial history seeding, follow-up accumulation, and human echo suppression.

## Related Work

- Builds on [Ctrl+O Keybinding — Full Bubbletea Stdin Ownership](2026-03-05-075631-ctrl-o-keybinding-full-bubbletea-stdin-ownership.md) (Phase 3)
- Builds on [Expanded Renderers for Tool Call Toggle](2026-03-05-071808-expanded-renderers-for-tool-call-toggle.md) (Phase 2)
- Builds on [Event History Retention and Subject Update](2026-03-05-070144-event-history-retention-and-subject-update.md) (Phase 1)

---

**Status**: ✅ Production Ready
**Timeline**: Session 4 of the expand-collapse-tools project
