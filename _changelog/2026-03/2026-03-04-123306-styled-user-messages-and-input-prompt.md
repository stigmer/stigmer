# Styled User Messages and Dedicated Input Prompt

**Date**: March 4, 2026

## Summary

Upgraded the Stigmer CLI inline renderer with two UX improvements that bring the conversational experience closer to Claude Code's polish: (1) user messages now render with a highlighted background block, making them visually distinct from AI output and status lines, and (2) the follow-up input prompt uses a styled bold-blue `>` marker instead of a bare shell-like `>`. Additionally, follow-up messages are now locally echoed immediately after the user presses Enter, eliminating the perceived latency of waiting for the backend round-trip.

## Problem Statement

The CLI's conversational UX had two visual gaps compared to Claude Code's CLI:

### Pain Points

- **User messages were invisible**: Rendered as plain `"You: message"` text with no visual distinction from surrounding tool output, system messages, or AI responses. In a busy session with many tool calls, the user's own messages disappeared into the noise.
- **Generic shell prompt**: The follow-up input prompt was a bare `\n> ` that looked like a shell command prompt rather than a dedicated conversational input section. No visual cue signaled "this is where you type your next message."
- **Follow-up echo latency**: After typing at the `>` prompt, the user saw nothing until the backend echoed the message back as a `HumanMessageEvent` — a round-trip delay before any confirmation of what they typed.

## Solution

Three coordinated changes to the inline rendering pipeline:

1. **Background-highlighted user message blocks** using lipgloss (dark gray background + bright white text + horizontal padding), applied consistently in both streaming and non-streaming rendering paths.
2. **Styled prompt marker** with bold blue `>` (color `"12"`, matching the session header panel theme) for visual continuity.
3. **Immediate local echo** with terminal cursor control: after the user presses Enter, the raw terminal echo is erased and replaced with the styled message block before the backend round-trip. A `suppressHumanEcho` flag on `inlineRenderConfig` prevents the backend's duplicate `HumanMessageEvent` from rendering twice.

## Implementation Details

### Shared Styles (`run_display.go`)

Added three new declarations alongside the existing `systemMsgStyle`:

- `humanMsgStyle`: `lipgloss.NewStyle().Background("236").Foreground("15").Padding(0, 1)` — the highlighted block
- `promptStyle`: `lipgloss.NewStyle().Bold(true).Foreground("12")` — the `>` marker
- `formatHumanMessage(content string) string` — reusable formatter for both rendering paths

Updated `displayHumanMessage` (non-streaming path) to use `formatHumanMessage` instead of plain `fmt.Printf`.

### Inline Renderer (`run_stream_inline.go`)

- Added `suppressHumanEcho bool` to `inlineRenderConfig` — set by the follow-up loop after local echo
- Updated `renderHumanMessage` to check the flag (resets on first use, so only one message is suppressed) and use `formatHumanMessage`

### Follow-Up Loop (`run_stream_inline_followup.go`)

- `readFollowUpInput`: renders `promptStyle.Render(">")` instead of bare `"> "`
- `runInlineFollowUpLoop`: after `readFollowUpInput` returns non-empty input:
  - Conditionally erases 2 terminal rows via `termctl.EraseLines` (no-op on non-TTY)
  - Renders the styled message block immediately
  - Sets `cfg.suppressHumanEcho = true`

### Tests

- Updated prompt assertion in `TestReadFollowUpInput_ReturnsInput` to be ANSI-safe (`">"` instead of `"> "`)
- Added local echo assertion in `TestFollowUpLoop_FollowUpError_ExitsLoop`
- Added two new tests: `TestInlineRenderer_SuppressHumanEcho_SkipsFirstHumanMessage` and `TestInlineRenderer_SuppressHumanEcho_OnlySkipsFirst`

## Benefits

- **Visual clarity**: User messages now stand out immediately in the terminal output, matching the visual hierarchy users expect from Claude Code
- **Input readiness**: The styled prompt clearly signals "type your follow-up here" rather than looking like a generic shell
- **Instant feedback**: Local echo eliminates the perceived latency gap between typing and seeing confirmation
- **Zero new dependencies**: Uses lipgloss and termctl already in the dependency tree
- **Graceful degradation**: On dumb terminals and in pipes, lipgloss produces plain text and cursor control is skipped

## Impact

- **End users**: Immediate visual improvement in every interactive session — user messages are distinguishable at a glance, and the input section feels purposeful
- **stdout/stderr separation**: Preserved — user messages stay on stderr, AI content on stdout remains pipeable
- **Test coverage**: Two new suppression tests ensure the echo deduplication logic is correct

## Related Work

- Follows the two-lane output architecture established in the inline streaming rewrite
- Builds on `termctl.EraseLines` (Phase 3.0) and `termctl.IsSupported` for safe cursor control
- Complements the session header panel (`run_stream_inline_header.go`) by using the same blue color for the prompt marker

---

**Status**: Production Ready
**Timeline**: Single session
