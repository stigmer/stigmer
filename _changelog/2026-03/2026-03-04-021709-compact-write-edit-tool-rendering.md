# Compact Write/Edit Tool Rendering (Phase 2.2)

**Date**: March 4, 2026

## Summary

Added compact rendering for write, create, and edit tool calls in the inline CLI, completing the second tool-type migration from the verbose gutter-bordered format to the bullet-style compact format. Running events now show a professional dim ellipsis instead of emoji badges, with graduated fallback for tools not yet converted.

## Problem Statement

Write and edit tools were still rendering in the legacy gutter-bordered format with emoji badges (`📝`, `⏳`, `✓`) — visually inconsistent with the compact read rendering added in Phase 2.1. The emoji-heavy approach made the CLI look unprofessional compared to tools like Claude Code that communicate state through structure, not decoration.

### Pain Points

- Visual inconsistency: reads rendered compact (`● Read(path)`), writes rendered with emoji gutter format (`📝 Write: path`)
- Emoji badges (`⏳`, `✓`) added noise without information — structure already communicates state
- Running events for write/edit tools used old `RenderWithBadge` format, creating jarring transitions when mixed with compact read output
- No graduated migration path for the running state — each tool type required separate handling

## Solution

Extended the `RenderCompact` graduated entry point to handle write/edit/create tools, and introduced `RenderCompactRunning` as a new graduated entry point for running state. Both use the same clean bullet-style format and fall back to the legacy renderer for tools not yet converted.

## Implementation Details

### New functions in `render_compact.go` (280 lines)

- **`RenderCompactRunning(tc, opts)`** — Compact running state with dim `…` suffix. Falls back to `RenderWithBadge` for tools without compact support.
- **`IsWriteOrEditTool(name)`** — Predicate matching write/write_file/create_file/overwrite_file/edit/edit_file.
- **`renderCompactWrite(tc, info, opts)`** — Two-line compact format using `resolveDisplayContent` to get line count from args content (not result), then `completedVerb` for proper past-tense.
- **`completedVerb(label)`** — Maps Write→"Wrote", Create→"Created", Edit→"Edited".
- **`hasCompactRenderer(info)`** — Graduated registry. As Phases 2.3-2.4 add shell and other compact renderers, they register here and running events automatically get compact formatting.
- **`isWriteOrEditLabel(label)`** — Shared predicate used by both routing and the public API.

### Inline renderer change in `run_stream_inline.go`

Single-line change: `renderToolRunning` now calls `RenderCompactRunning` instead of `RenderWithBadge`. The graduated fallback means shell, unknown, and future tools are unaffected.

### Design decisions

1. **No emoji badges** — Structure communicates state. Result summary line = done. Error line = failed. `…` suffix = running.
2. **Running events kept for writes/edits** — Unlike reads (<100ms), writes have observable latency. Suppressing would create "is it stuck?" anxiety.
3. **Waiting-approval state untouched** — The verbose gutter preview is intentionally kept for approval decisions. Phase 3 scope.
4. **Line count from args content** — Write tools use `resolveDisplayContent` (which respects `contentSourceInput`), so line count comes from the file content being written, not the "wrote N bytes" confirmation.

## Benefits

- Consistent visual language across read, write, create, and edit tools
- Professional aesthetic matching Claude Code's tool output style
- Graduated migration: each phase adds tool types without touching prior work
- `hasCompactRenderer` eliminates per-tool-type running event handling

## Impact

- **End users**: Cleaner, less noisy inline output for file mutation operations
- **Maintainers**: Clear pattern for adding compact rendering to remaining tools (shell, glob, search, delete, think) in Phases 2.3-2.4
- **Architecture**: `RenderCompactRunning` + `hasCompactRenderer` provide a zero-touch upgrade path for running state as new compact renderers are added

## Related Work

- Phase 2.0: OSC 8 file hyperlink primitives (`hyperlink.go`)
- Phase 2.1: Compact read tool rendering (`renderCompactRead`)
- Phase 2.1b: Consecutive read grouping (`RenderReadGroup`)
- Phase 2.3 (next): Shell tool compact rendering
- Phase 3: Streamlined approval prompts (richer content preview for write approvals)

---

**Status**: Production Ready
**Timeline**: 1 session
