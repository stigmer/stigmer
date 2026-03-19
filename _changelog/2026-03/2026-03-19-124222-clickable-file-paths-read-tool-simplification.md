# Clickable File Paths and Read Tool Simplification

**Date**: March 19, 2026

## Summary

File paths in the execution thread are now interactive — git-sourced paths open on GitHub in a new tab, local and platform paths copy to clipboard. Completed Read tool items are simplified to non-expandable single-line rows, removing redundant content display that provided no user value.

## Problem Statement

File paths rendered by tool calls (Read, Write, Edit, Delete) were static text. Users had to manually navigate to GitHub or copy-paste paths to view files the agent referenced. The Read tool's expanded detail view was particularly problematic — it showed the path again (redundant) followed by file content that was either truncated, omitted (`[content omitted ~ 12721 chars]`), or irrelevant (the content is the agent's input, not the user's concern).

### Pain Points

- Paths in tool call rendering were not clickable — no way to navigate to the file
- Read tool expansion added three levels of redundancy (group summary, item row, detail panel) all showing the same path
- `[content omitted ~ N chars]` provided zero information value
- The CLI already rendered Read as a single-line display with clickable terminal hyperlinks — the web console was behind

## Solution

Two complementary changes in `@stigmer/react`:

1. **`FilePathLink` component** — replaces all inert `<span>{path}</span>` elements with an interactive component that resolves paths against workspace entries to determine the appropriate action (open URL or copy to clipboard).

2. **Read tool simplification** — completed/skipped Read items render as non-expandable `<div>` rows with the clickable path directly inline. No chevron, no expansion, no content block. Failed Read items remain expandable to show error messages.

## Implementation Details

### New Files

- **`file-path-resolver.ts`** — Pure utility functions with zero React dependency:
  - `classifyPath()` detects `.stigmer/` platform paths vs workspace paths (mirrors the Python `classify_platform_path`)
  - `resolveGitBrowseUrl()` constructs GitHub blob URLs from `GitRepoSource` data
  - `resolvePathAction()` orchestrates classification, workspace entry matching, and action resolution

- **`FilePathContext.tsx`** — Lightweight React context carrying workspace entries and an optional `onFilePathClick` callback. Avoids prop-drilling through 5 component layers.

- **`FilePathLink.tsx`** — Styled interactive component:
  - Git-sourced paths → `<a>` with external-link icon (opens GitHub in new tab)
  - Local/platform paths → `<button>` with copy icon and inline "Copied" feedback
  - Platform builders override via `onFilePathClick` callback in context

### Modified Files

- **`MessageThread.tsx`** — Accepts `workspaceEntries` and `onFilePathClick` props; wraps children with `FilePathContext.Provider`
- **`ToolCallItem.tsx`** — Completed/skipped Read items render as non-expandable rows with `FilePathLink`; extracted shared trailing content to avoid duplication
- **`ToolCallDetail.tsx`** — `FileToolDetail` for read mode removes `CollapsibleCode` content block; write/edit/delete modes replace path spans with `FilePathLink`
- **`ApprovalCard.tsx`** — `FileArgsPreview` uses `FilePathLink` instead of plain text

### Nested Interactive Element Solution

The plan identified that placing a clickable `FilePathLink` inside a `<button>` (the expandable row) creates invalid HTML. The solution: Read items (non-expandable) render as a `<div>` — `FilePathLink` is the sole interactive element. Other tool types keep the expandable `<button>` row with plain text subtitles; the clickable path lives in the expanded detail panel.

## Benefits

- **Single-click file access** for git-sourced workspace paths (opens on GitHub)
- **Copy-to-clipboard** for local paths with inline "Copied" feedback
- **Reduced visual noise** — Read tool items no longer show redundant content
- **Parity with CLI** — the web console matches the CLI's single-line Read display
- **Platform builder extensibility** — `onFilePathClick` callback and exported utilities enable custom file viewers

## Impact

- **SDK** (`@stigmer/react`): New public API — `FilePathLink`, `FilePathContext`, `resolvePathAction`, `resolveGitBrowseUrl`, `classifyPath` and associated types
- **Console** (`client-apps/web`): `SessionPage` passes `conv.workspaceEntries` to `MessageThread`
- **Platform builders**: Read items are non-expandable by default; `toolCall.result` data remains available via hooks for audit/compliance use cases

## Related Work

- CLI hyperlink support: `client-apps/cli/pkg/toolrender/render_compact.go` (`buildHyperlinkedPath`)
- Virtual platform mount: `backend/libs/python/graphton/src/graphton/core/backends/platform_mount.py`
- Workspace entry proto: `apis/ai/stigmer/agentic/session/v1/workspace.proto`

---

**Status**: ✅ Production Ready
