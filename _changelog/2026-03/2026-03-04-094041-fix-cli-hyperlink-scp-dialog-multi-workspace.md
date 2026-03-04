# Fix CLI File Hyperlinks Triggering SCP Dialog in Multi-Workspace Sessions

**Date**: March 4, 2026

## Summary

Fixed a critical UX bug where clicking OSC 8 file hyperlinks in the Stigmer CLI triggered an SCP download dialog instead of opening the file locally. The root cause was a malformed `file://` URI produced from relative paths in multi-workspace sessions, where the first path segment (e.g., `mcp-server-planton`) was misinterpreted as a hostname by the terminal emulator.

## Problem Statement

When running multi-workspace agent sessions in the CLI (e.g., `stigmer run agent x -w ./frontend -w ./backend`), clicking on file paths displayed next to Read, Write, and other tool outputs produced a system dialog asking for SCP credentials instead of opening the file.

### Pain Points

- Clicking a file link like `mcp-server-planton/README.md` produced a dialog: "Enter username for host mcp-server-planton to download file with scp"
- The CLI was unusable for file navigation in multi-workspace sessions
- Single-workspace sessions with relative paths also produced broken links (though less visibly — the terminal silently failed to resolve the path)
- No graceful degradation — broken links were worse than no links at all

## Solution

Three-layer fix addressing the root cause and preventing recurrence:

1. **Guard at the boundary**: `FileHyperlink` now rejects relative paths — returns plain display text instead of producing a malformed URI
2. **Workspace-aware path resolution**: Replaced scalar `WorkingDir string` with `WorkspaceRoots []string` that resolves relative paths against known local workspace directories, matching the first path segment against workspace root basenames
3. **Thread workspace context**: Local workspace root paths are now threaded from session initialization through the rendering pipeline

## Implementation Details

### Root Cause Analysis

Go's `url.URL{Scheme: "file", Path: "mcp-server-planton/README.md"}.String()` produces `file://mcp-server-planton/README.md`. Per RFC 8089, the part between `file://` and the next `/` is the **host component**. The terminal faithfully interpreted this as a remote file on host `mcp-server-planton` and attempted SCP access.

The inline renderer never set `WorkingDir` (it defaulted to `""`), so relative paths passed through `fileURI` unresolved. An existing test (`TestBuildHyperlinkedPath_RelativePathNoWorkingDir`) actually asserted this broken URI as expected behavior.

### Changes

**Guard layer** (`hyperlink.go`):
- `FileHyperlink` now checks `filepath.IsAbs(absolutePath)` and degrades to plain text for relative paths

**Resolution layer** (`render_compact.go`):
- `CompactOptions.WorkingDir string` → `CompactOptions.WorkspaceRoots []string`
- New `resolveWorkspacePath()` function:
  - Single root: joins directly
  - Multi-root: matches first path segment against `filepath.Base()` of each root
  - No match: returns empty string (triggers graceful degradation)
- `buildHyperlinkedPath` now degrades to plain text when resolution fails

**Threading layer** (4 files):
- `inlineRenderConfig` gained `workspaceRoots []string`
- `renderInline` threads it into `CompactOptions.WorkspaceRoots`
- `streamAgentExecution` and `streamAgentInline` accept and pass workspace roots
- `executeResolvedAgent` passes `localWorkspaceRoots(input.WorkspaceEntries)`
- `openSession` and `resumeSession` extract roots from `ses.GetSpec().GetWorkspaceEntries()`

### Files Changed

| File | Change |
|------|--------|
| `pkg/toolrender/hyperlink.go` | Guard `FileHyperlink` against relative paths |
| `pkg/toolrender/render_compact.go` | `WorkingDir` → `WorkspaceRoots`, add `resolveWorkspacePath` |
| `cmd/stigmer/root/run_stream_inline.go` | Add `workspaceRoots` to config struct |
| `cmd/stigmer/root/run_stream.go` | Thread workspace roots through streaming functions |
| `cmd/stigmer/root/run_agent_exec.go` | Pass workspace roots from execution input |
| `cmd/stigmer/root/run_session.go` | Extract workspace roots from session spec |
| `pkg/toolrender/hyperlink_test.go` | Add relative-path degradation tests |
| `pkg/toolrender/render_compact_test.go` | Multi-root matching tests, degradation tests |

## Benefits

- **No more SCP dialogs**: Relative paths degrade to plain text instead of producing malformed URIs
- **Multi-workspace links work**: `backend/src/main.go` correctly resolves to `file:///Users/.../backend/src/main.go` when workspace roots are known
- **Single-workspace links work**: All relative paths resolve against the single root
- **Safe degradation**: When resolution is impossible, the path renders as plain text — no link is better than a broken link

## Impact

- All CLI users running multi-workspace sessions will see working file hyperlinks
- Session re-open (`stigmer run ses-xxx`) also gets correct hyperlinks via workspace entries stored in the session spec
- No behavioral change for absolute paths (already worked correctly)

## Related Work

- [OSC 8 File Hyperlink Primitives](2026-03-04-011744-osc8-file-hyperlink-primitives.md) — original hyperlink implementation
- [CLI Multi-Workspace Support](2026-03-04-011542-cli-multi-workspace-support.md) — workspace entry infrastructure
- [Multi-Workspace Relevance Signaling](2026-03-04-083435-multi-workspace-relevance-signaling.md) — related multi-workspace work

---

**Status**: ✅ Production Ready
**Timeline**: Single conversation
