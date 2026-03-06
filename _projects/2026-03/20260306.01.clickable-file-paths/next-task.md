# Next Task: 20260306.01.clickable-file-paths

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260306.01.clickable-file-paths

**Description**: Make file paths in tool outputs (Read, Write, Edit, etc.) clickable in the terminal via OSC 8 hyperlinks. Currently, hyperlinks only work for local workspace paths; git workspaces, .stigmer paths, and session artifacts are not resolved.
**Goal**: All file paths displayed in compact tool rendering should be clickable and open the correct local file, regardless of workspace type (local, git) or path origin (.stigmer, workspace-relative).
**Tech Stack**: Go (BubbleTea TUI, lipgloss), pkg/toolrender/, cmd/stigmer/root/

## Current State
- **Status**: Implementation complete, pending manual verification
- **Last Session**: 2026-03-07 — Full implementation of session-aware path resolution
- **Active Task**: Manual verification (T03)

## Session Progress (2026-03-07)
- Approved T01 plan and implemented T02 (full feature) in one session
- Added `SandboxRoot` and `PlatformDir` to `CompactOptions`
- Implemented 3-layer path resolution: `.stigmer/` prefix → PlatformDir, workspace roots → basename match, sandbox root → fallback
- Added `sessionPaths(sessionID)` helper and wired through all render paths
- Added 10 test cases covering all resolution layers and edge cases
- Decided to keep generic `file://` URIs (no editor-specific schemes)
- Fixed macOS file associations via `duti` to open dev files in Cursor

## Next Steps
1. Manual verification with live sessions:
   - Local workspace: confirm existing hyperlinks still work
   - Git workspace (`--workspace https://...`): confirm file paths resolve via sandbox root
   - `.stigmer/` paths: confirm skill/platform files resolve via PlatformDir
2. Verify BubbleTea `tea.Println` passes OSC 8 sequences through
3. If all working, mark project complete

## Context for Resume
- Implementation is in 7 files (see checkpoint for details)
- Tests pass locally — 10 new test cases in `render_compact_test.go`
- The `sessionPaths` helper uses `config.GetConfigDir()` + `config.DefaultDataDir` to compute paths
- Resolution priority: `.stigmer/` > workspace roots > sandbox root
- Decision: no editor-specific URI schemes — `file://` is the generic solution (consistent with Claude Code)

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260306.01.clickable-file-paths/checkpoints/2026-03-07-session-1.md
```

### 2. Core Implementation
- `client-apps/cli/pkg/toolrender/render_compact.go` — `resolveWorkspacePath`, `CompactOptions`
- `client-apps/cli/pkg/toolrender/render_compact_test.go` — test cases
- `client-apps/cli/cmd/stigmer/root/run.go` — `sessionPaths` helper

### 3. Task Plan
```
_projects/2026-03/20260306.01.clickable-file-paths/tasks/T01_0_plan.md
```

## Knowledge Folders to Check

### Design Decisions
```
_projects/2026-03/20260306.01.clickable-file-paths/design-decisions/
```

### Wrong Assumptions
```
_projects/2026-03/20260306.01.clickable-file-paths/wrong-assumptions/
```

### Don't Dos
```
_projects/2026-03/20260306.01.clickable-file-paths/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/2026-03-07-session-1.md`
2. [ ] Check task status in `tasks/`
3. [ ] Run a live session and test clickable file paths manually
4. [ ] If all pass, mark project complete

## Quick Commands

After loading context:
- "Verify clickable file paths" - Run manual verification
- "Show project status" - Get overview of progress
- "Mark project complete" - If verification passes

---

*This file provides direct paths to all project resources for quick context loading.*
