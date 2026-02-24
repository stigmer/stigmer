# CLI Markdown Rendering for Agent Responses

**Date**: February 24, 2026

## Summary

Added terminal-native markdown rendering for AI agent responses in the Stigmer CLI. Agent responses containing markdown (headers, bold, code blocks, lists) are now rendered with ANSI styling via glamour instead of being dumped as raw text. The implementation covers both the TUI (primary) and non-TUI rendering paths, with a clean streaming-to-rendered transition in the TUI.

## Problem Statement

Agent LLM responses arrive as markdown — headers, bold text, code blocks, numbered lists, bullet points — but the CLI displayed them verbatim as raw text. Users saw `# Header`, `**bold**`, and triple-backtick fences instead of styled, formatted terminal output.

### Pain Points

- Raw markdown syntax cluttered the terminal and reduced readability
- Code blocks appeared without syntax highlighting despite chroma already being a dependency
- Headers, lists, and emphasis were indistinguishable from body text
- The CLI's visual quality didn't match the maturity of the rest of the platform

## Solution

Integrated [glamour](https://github.com/charmbracelet/glamour) (Charmbracelet ecosystem) to convert markdown to ANSI-styled terminal output. The rendering is applied at the display layer — no changes to data flow or message handling.

## Implementation Details

### New package: `pkg/mdrender/`

A thin, domain-agnostic wrapper around glamour following the CLI's `pkg/` conventions:

- `Render(content string, width int) string` — converts markdown to styled ANSI text with word wrapping. Never returns an error; falls back to raw content gracefully.
- `HasMarkdown(content string) bool` — heuristic detection of markdown syntax (headers, lists, bold, code fences, blockquotes) to decide between inline and block prefix formatting.
- Renderer instances are cached by width via `sync.Map` to avoid repeated creation.

### TUI mode (primary interactive experience)

- During **streaming**: raw text + cursor indicator (unchanged behavior)
- On **stream finalize** (`AIStreamEndEvent`): block content swaps to glamour-rendered ANSI markdown via `renderAIContent`
- The viewport rebuilds from blocks, so the transition from raw streaming to rendered output is a clean single-frame swap

### Non-TUI mode

- **Complete messages** (late subscription, `stigmer get execution` replay): rendered via `formatNonTUIAIText` using `display.GetTerminalWidth()`
- **Streaming messages** (delta-by-delta output): stays raw — re-rendering after streaming would require ANSI cursor manipulation, which is fragile

### Prefix format adaptation

- Markdown content: prefix on its own line (`🤖 Agent:\n<rendered>`) to avoid conflicting with glamour's formatting
- Plain text: compact inline prefix preserved (`🤖 Agent: text`)

### Files changed

| File | Change |
|------|--------|
| `pkg/mdrender/render.go` | New — core rendering, caching, fallback |
| `pkg/mdrender/render_test.go` | New — 17 tests |
| `pkg/executiontui/render_blocks.go` | Added `formatAIText`, `width` param to `renderAIContent` |
| `pkg/executiontui/handle_events.go` | Pass `m.width` to `renderAIContent` |
| `pkg/executiontui/replay.go` | `width` param for replay/resume blocks |
| `pkg/executiontui/render_blocks_test.go` | Updated + 4 new markdown tests |
| `cmd/stigmer/root/run_display.go` | Added `formatNonTUIAIText` |
| `cmd/stigmer/root/run_display_stream.go` | Use `formatNonTUIAIText` for complete messages |
| `cmd/stigmer/root/run_display_stream_test.go` | 4 new markdown rendering tests |
| `cmd/stigmer/root/run_session.go` | Pass terminal width to replay builder |
| `go.mod` | Added `glamour v0.10.0` |

## Benefits

- Agent responses now render with styled headers, bold/italic, syntax-highlighted code blocks, formatted lists, and tables
- Consistent visual quality across the CLI matching the platform's maturity
- Zero impact on streaming UX — raw text during streaming, rendered on completion
- Graceful degradation — if glamour ever fails, raw content is shown (never breaks the display path)
- Follows existing codebase patterns: Charmbracelet ecosystem, `pkg/` for reusable utilities, dependency injection

## Impact

- **End users**: Dramatically improved readability of agent responses in terminal
- **TUI mode**: Smooth raw→rendered transition when streaming completes
- **Non-TUI mode**: Complete messages rendered; streaming stays raw (deliberate v1 trade-off)
- **Tests**: 25 new/updated tests across 3 packages, all existing tests unaffected

## Related Work

- Builds on existing Charmbracelet stack (lipgloss, bubbletea, bubbles)
- Complements existing `pkg/toolrender/` syntax highlighting for tool output (chroma)
- Uses existing `pkg/display/` terminal width detection

---

**Status**: ✅ Production Ready
