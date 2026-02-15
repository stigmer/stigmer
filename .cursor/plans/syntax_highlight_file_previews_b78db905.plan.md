---
name: Syntax highlight file previews
overview: Add syntax highlighting to the Read tool's file content previews (both collapsed 3-line and expanded full-content views) in the Stigmer CLI, supporting .proto, .md, .yaml, .json, and other common file types via the chroma library.
todos:
  - id: add-chroma-dep
    content: Add alecthomas/chroma/v2 dependency to client-apps/cli/go.mod
    status: completed
  - id: create-highlight
    content: Create toolrender/highlight.go with highlightContent() function using chroma lexer auto-detection and terminal256 formatter
    status: completed
  - id: ansi-truncate
    content: Add ANSI-aware truncate variant in format.go using charmbracelet/x/ansi
    status: completed
  - id: update-file-preview
    content: Update formatFileContentPreview and formatFullResultWithGutter to accept filename, apply highlighting, and split gutter/content styling
    status: completed
  - id: update-callers
    content: Update renderKnown() and RenderExpanded() to extract filename from tc.Args and pass to formatting functions; adjust dimStyle wrapping
    status: completed
  - id: tests
    content: Add highlight_test.go with test cases for known extensions, unknown extensions, empty content, and ANSI-aware truncation
    status: completed
  - id: build-verify
    content: Build and verify the CLI compiles, run existing tests, and manually verify terminal output
    status: completed
isProject: false
---

# Syntax Highlighting for Read Tool File Previews

## Scope

Add ANSI syntax highlighting to file content displayed by the Read tool in both collapsed (3-line preview) and expanded (full content) views. Target file types: `.proto`, `.md`, `.yaml`, `.json`, `.go`, `.py`, `.ts`, `.toml`, and any other extension chroma supports out of the box.

All changes are contained within the CLI's `toolrender` package at `[client-apps/cli/pkg/toolrender/](client-apps/cli/pkg/toolrender/)`.

## Key Design Decisions

### Library: `alecthomas/chroma/v2`

- The de facto Go syntax highlighting library. Mature, well-maintained, supports 200+ languages including all our targets.
- Provides terminal ANSI formatters (256-color, true-color) with built-in dark/light theme support.
- chroma auto-detects language from filename, so we don't need to maintain our own extension map.

### Highlight-then-slice (not slice-then-highlight)

- Highlight the full file content, then split into lines for preview truncation.
- This preserves correct syntax state across multi-line constructs (e.g., YAML multi-line strings, JSON arrays).
- The performance cost is negligible — chroma highlights thousands of lines in sub-millisecond time.

### Gutter/content style separation

- Currently, `dimStyle.Render()` wraps the entire gutter+content block. This must change.
- New approach: apply dim style only to the gutter prefix (`│`), leave content with its own ANSI highlighting.
- Fallback: when highlighting is unavailable (unknown extension, error), content stays dim (current behavior preserved).

### ANSI-aware truncation

- Replace the raw-rune `truncate()` calls on highlighted content with `ansi.Truncate()` from `charmbracelet/x/ansi` (already an indirect dependency).

## Files Changed

### New file: `toolrender/highlight.go`

- `highlightContent(content, filename string) (string, bool)` — returns highlighted content and whether highlighting was applied.
- Uses `chroma/v2` lexers (auto-detect by filename) + terminal256 formatter with a dark-background-friendly style (e.g., `monokai` or `dracula`).
- Graceful fallback: returns original content + `false` if lexer not found or highlighting fails.

### Modified: `[toolrender/file_preview.go](client-apps/cli/pkg/toolrender/file_preview.go)`

- `formatFileContentPreview(result string)` -> `formatFileContentPreview(result, filename string)`
- `formatFullResultWithGutter(result string)` -> `formatFullResultWithGutter(result, filename string)`
- Both functions call `highlightContent()` first, then split/format.
- When highlighted, per-line rendering applies dim style only to the gutter prefix, not the content.
- When not highlighted, current dim-everything behavior is preserved.

### Modified: `[toolrender/render_known.go](client-apps/cli/pkg/toolrender/render_known.go)`

- `renderKnown()`: extract filename from `tc.Args` and pass it to `formatFileContentPreview()`.
- Adjust the `dimStyle.Render(preview)` wrapping — when content is highlighted, the preview string already contains ANSI codes, so we skip the outer dim wrapper.

### Modified: `[toolrender/render.go](client-apps/cli/pkg/toolrender/render.go)`

- `RenderExpanded()`: extract filename from `tc` and pass to `formatFullResultWithGutter()`.
- Same dimStyle adjustment as above.

### Modified: `[toolrender/format.go](client-apps/cli/pkg/toolrender/format.go)`

- Add an ANSI-aware variant of `truncate()` using `charmbracelet/x/ansi` for use on highlighted lines.

### New file: `toolrender/highlight_test.go`

- Test cases for extension detection, highlighting, and graceful fallback.
- Verify that highlighted output contains ANSI codes for known extensions.
- Verify plain-text fallback for unknown extensions.

## What This Does NOT Change

- The Python backend (`graphton`) — no changes needed; the highlighting is purely a CLI rendering concern.
- The TUI model/controller (`executiontui/`) — it already calls `toolrender.Render()` and `toolrender.RenderExpanded()`, so it gets highlighting for free.
- Shell tool output, discovery previews, or any other tool category — only `previewFileContent` style is affected.

## Risk Assessment

- **Low risk**: Changes are additive and contained. The fallback path preserves current behavior exactly.
- **Terminal compatibility**: chroma's terminal256 formatter works on all modern terminals. True-color is optional and can be added later.
- **Performance**: Negligible. chroma highlights thousands of lines in microseconds. For the 3-line preview, effectively free.

