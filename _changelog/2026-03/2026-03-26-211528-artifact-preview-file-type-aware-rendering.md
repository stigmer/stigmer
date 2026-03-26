# Artifact Preview: File-Type-Aware Content Rendering

**Date**: March 26, 2026

## Summary

Upgraded the `ArtifactPreviewModal` in `@stigmer/react` to render artifact content based on file type instead of treating everything as plain monospace text. Markdown files now render as rich HTML with the existing `react-markdown` pipeline, YAML retains its CSS-only syntax highlighting, JSON gets pretty-printing with key/value coloring, and all other text files display with line numbers. A new standalone `ArtifactContentRenderer` component is exported for platform builders who need file-type-aware rendering outside of the modal.

## Problem Statement

The `ArtifactPreviewModal` treated all non-YAML file content as raw monospace text in a `<pre><code>` block. A `.md` file like `mahatma_gandhi.md` showed headings as `## Born` instead of rendered typography. The modal was also narrow (`max-w-2xl` / 672px) and lacked explicit centering CSS, which could cause positioning issues when CSS resets interfere with native `<dialog>` defaults.

### Pain Points

- Markdown artifacts displayed as raw source instead of rendered HTML
- No differentiation between JSON, YAML, code, and plain text files
- Modal width was narrow for content review
- No source/rendered toggle for markdown files
- The rendering logic was an internal function inside a 943-line file, not reusable by platform builders

## Solution

Extracted file-type-aware rendering into a standalone `ArtifactContentRenderer` component following the SDK-first/headless-first pattern. Added `getArtifactRenderMode()` as a pure utility for render mode detection. Reused the existing `react-markdown` + `remark-gfm` + `MARKDOWN_COMPONENTS` infrastructure already in `@stigmer/react` — zero new dependencies.

## Implementation Details

### New Files

- **`sdk/react/src/execution/ArtifactContentRenderer.tsx`** — Exported component that dispatches to file-type-specific renderers:
  - `MarkdownView` — `react-markdown` with themed `MARKDOWN_COMPONENTS` and a source/rendered toggle
  - `YamlView` — CSS-only syntax highlighting (moved from the modal)
  - `JsonView` — Pretty-printed JSON with key/string/number/boolean coloring
  - `PlainTextView` — Monospace with line numbers

### Modified Files

- **`sdk/react/src/execution/artifact-utils.ts`** — Added `ArtifactRenderMode` type, `getFileExtension()` utility, and `getArtifactRenderMode()` function. Refactored `getArtifactExtension()` to delegate to `getFileExtension()`.
- **`sdk/react/src/execution/ArtifactPreviewModal.tsx`** — Replaced inline `FileContentView` and YAML highlighting functions with `ArtifactContentRenderer`. Widened modal from `max-w-2xl` to `max-w-3xl`. Added explicit centering CSS (`fixed inset-0 m-auto`). Modal is ~120 lines shorter.
- **`sdk/react/src/execution/index.ts`** — Added barrel exports for new public API.
- **`sdk/react/src/index.ts`** — Re-exported new surface through root barrel.

### Rendering Strategy

| Extension(s)    | Mode       | Approach                                          |
|-----------------|------------|---------------------------------------------------|
| `.md`, `.mdx`   | `markdown` | `react-markdown` + `REMARK_PLUGINS` + themed components |
| `.yaml`, `.yml` | `yaml`     | CSS-only `highlightYaml()` (existing)             |
| `.json`         | `json`     | `JSON.parse` + pretty-print + key/value coloring  |
| All other text  | `text`     | Monospace `<pre><code>` with line numbers          |

## Benefits

- Markdown artifacts render as rich, readable HTML instead of raw source
- Developers can toggle between rendered and source views for markdown
- JSON artifacts are pretty-printed and color-coded
- Text files show line numbers for reference
- Platform builders can import `ArtifactContentRenderer` for custom layouts without the modal
- `getArtifactRenderMode()` available as a standalone utility
- Zero new dependencies — reuses existing `react-markdown` infrastructure
- Modal is wider and explicitly centered for better viewport behavior

## Impact

- **SDK consumers**: New `ArtifactContentRenderer` component and `getArtifactRenderMode` utility available from `@stigmer/react`
- **Console users**: Artifact previews now render markdown, format JSON, and show line numbers for code files
- **Bundle size**: No increase — `react-markdown` and `remark-gfm` were already dependencies

## Related Work

- `sdk/react/src/internal/markdown-components.tsx` — Shared `MARKDOWN_COMPONENTS` used by `MessageEntry`, `SkillDetailView`, and now `ArtifactContentRenderer`
- `sdk/react/src/execution/ArtifactPreviewModal.tsx` — Existing modal, now slimmed down
- Deferred: Syntax highlighting for code files (`.py`, `.ts`, `.go`, etc.) — requires dependency evaluation for bundle size

---

**Status**: ✅ Production Ready
