# Wrong Assumption 001: All Output Through Single Bubbletea Writer

**Date**: 2026-03-05
**Phase**: Planning -> Phase 1 implementation

## The Assumption

The original T01 plan assumed all inline output (AI streaming, status messages, tool rendering, approval panels) could flow through a single Bubbletea `tea.Program` using `tea.Println()` for committed output and `View()` for the active region.

## Why It Was Wrong

`tea.Println` is line-based -- it always appends `\r\n` to each line. The Stigmer CLI's primary output is token-by-token AI streaming (individual characters/words arriving from the LLM). Forcing this through Println would:

1. Buffer characters until a newline, destroying the typewriter effect
2. Add spurious `\r\n` after partial tokens
3. Break markdown rendering which depends on accumulating a full message before rendering

## What We Did Instead

Kept the existing stdout/stderr split:
- **stdout** (`dataW`): AI content streams directly via `fmt.Fprintf`, preserving token-by-token rendering
- **stderr** (`statusW`): Status output routes through `program.Println()` for Bubbletea row tracking

## Lesson

When planning framework integrations, validate the framework's API constraints against the most demanding output pattern (in this case, character-level streaming) before committing to a "single writer" architecture. The Bubbletea source code (`tea.go`, `standard_renderer.go`) needed to be read to discover the `\r\n` behavior -- it's not documented in the README.
