# Session-Aware File Path Hyperlinks

**Date**: March 7, 2026

## Summary

Extended the CLI's OSC 8 file hyperlink system to resolve `.stigmer/` virtual-mount paths and Git workspace paths. Previously, only local workspace paths produced clickable hyperlinks; now all file paths in compact tool output are clickable regardless of workspace type or path origin.

## Problem Statement

File paths displayed in compact tool rendering (`Read`, `Write`, `Edit`, etc.) should be clickable OSC 8 hyperlinks that open the correct local file. The existing resolver only knew about `WorkspaceRoots` (user's local workspace paths) and could not handle two important categories:

### Pain Points

- `.stigmer/` prefix paths (e.g., `.stigmer/skills/mcp-server-creator/SKILL.md`) are a virtual mount — the directory doesn't exist on disk. The agent intercepts the prefix and redirects to the session's platform directory.
- Git workspace paths (e.g., `repo-name/README.md` when `--workspace https://github.com/org/repo` is used) were entirely skipped by `localWorkspaceRoots()`, producing nil roots and no hyperlinks.
- Both path types silently degraded to plain text with no visual indication of the failure.

## Solution

Added a 3-layer path resolution strategy to `resolveWorkspacePath` with two new fields on `CompactOptions`:

1. **`.stigmer/` prefix** → Strip prefix, join with `PlatformDir`, stat-probe
2. **Workspace roots** → Basename-match + stat-probe (existing behavior preserved)
3. **Sandbox root** → Join directly, stat-probe (universal fallback covering git clones and symlinked local paths)

## Implementation Details

- Added `SandboxRoot` (`~/.stigmer/data/workspace/sessions/<session-id>/`) and `PlatformDir` (`~/.stigmer/sessions/<session-id>/platform/`) to `CompactOptions`
- Extracted `resolveAgainstWorkspaceRoots` and `statProbe` helpers for cleaner layered resolution
- Added `sessionPaths(sessionID)` helper in `run.go` to compute both paths from session ID and config directory
- Wired session paths through `run_stream.go`, `run_session.go` → `inlineRenderConfig` → `CompactOptions`
- Added 10 test cases covering all resolution layers, priority ordering, and graceful degradation

## Benefits

- All file paths in agent output are now clickable, not just local workspace paths
- Git workspace users get the same clickable-path experience as local workspace users
- `.stigmer/` skill and platform files are navigable directly from tool output
- Graceful degradation: unresolvable paths remain plain text (no broken `file://` URIs)

## Impact

- **Users**: Every file path in compact tool output is now a clickable hyperlink in terminals supporting OSC 8 (iTerm2, Ghostty, WezTerm, Warp)
- **Files changed**: 7 files, +274/-14 lines
- **Test coverage**: 10 new test cases for the expanded resolution logic

## Related Work

- Builds on `2026-03-04-011744-osc8-file-hyperlink-primitives.md` (initial OSC 8 infrastructure)
- Builds on `2026-03-05-005730-fix-terminal-file-hyperlinks.md` (workspace root resolution)

---

**Status**: Production Ready
