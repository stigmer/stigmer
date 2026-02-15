# Session-Scoped Local Workspace Directories

**Date**: February 15, 2026

## Summary

Added session-scoped workspace isolation for local mode agent execution. When a `session_id` is provided, the filesystem backend's `root_dir` is scoped to `{SANDBOX_ROOT_DIR}/sessions/{session_id}/`, giving each session its own persistent, isolated workspace directory. This is the foundation for T01 of the persistent session workspace project.

## Problem Statement

In local mode, all agent executions shared the same flat workspace directory (`SANDBOX_ROOT_DIR`, default `./workspace`). This meant:

- Multiple sessions could clobber each other's files (skills, attachments, work products)
- Post-approval execution resumes in local mode had no guarantee that files from the original execution were still intact
- There was no session-level isolation — the filesystem was a shared, unscoped resource

### Pain Points

- No workspace isolation between sessions in local mode
- Resume after approval could find unexpected file state from other sessions
- Cloud mode had session-scoped sandbox reuse (via `sandbox_id` stored in session), but local mode had nothing equivalent

## Solution

Extended `Config.get_sandbox_config()` to accept an optional `session_id` parameter. In local mode, when a session_id is provided, the workspace root is constructed as `{SANDBOX_ROOT_DIR}/sessions/{session_id}/` instead of the flat `SANDBOX_ROOT_DIR`. This gives each session its own isolated directory tree while remaining fully backward-compatible (no session_id means unchanged behavior).

## Implementation Details

### Files Changed

**`backend/services/agent-runner/worker/config.py`** (~15 lines):
- Added `from pathlib import Path` import
- Extended `get_sandbox_config(self, session_id: str | None = None)` with:
  - Session ID path-traversal validation (rejects `/`, `\`, `..`)
  - Session-scoped `root_dir` construction using `Path` for safe path joining
  - Full docstring covering the new parameter, return values, and raised exceptions

**`backend/services/agent-runner/worker/activities/execute_graphton.py`** (1 line):
- Updated the single call site to pass `session_id=session_id` (the variable already validated at line 519)

### Design Decisions

- **Validation over sanitization**: The session_id is validated for path safety characters rather than silently sanitized. Session IDs are platform-generated UUIDs, but defense in depth is appropriate for foundational infrastructure.
- **No directory creation in config**: `FilesystemBackend.__init__()` already calls `mkdir(parents=True, exist_ok=True)`, and all intermediate consumers (skill writer, attachment injector) create their own subdirectories. Configuration methods should not have filesystem side effects.
- **Backward compatible**: When `session_id` is `None`, behavior is identical to before. No existing tests or call patterns break.

### What Didn't Need to Change

- `FilesystemBackend` — already root_dir-agnostic with chroot-like path resolution
- `sandbox_factory.py` — already reads `config.get("root_dir", ".")` and passes through
- All downstream consumers — already read `sandbox_config.get('root_dir')`, automatically pick up session-scoped paths
- Cloud mode — completely unaffected; session isolation handled by Daytona volumes (future T03)

## Benefits

- **Session isolation**: Each session gets its own workspace directory, preventing cross-session file conflicts
- **Resume safety**: Post-approval resume in local mode can rely on workspace files persisting per-session
- **Zero downstream changes**: All existing consumers automatically get session-scoped paths
- **Backward compatible**: No `session_id` means unchanged behavior
- **Foundation for volumes**: Establishes the session-scoped workspace pattern that T03 (Daytona volumes) will mirror in cloud mode

## Impact

- **Agent runner (local mode)**: Workspace directories are now per-session instead of shared
- **Developer testing**: Local agent executions within the same session will share workspace state; different sessions are isolated
- **No breaking changes**: Existing behavior preserved when `session_id` is not provided

## Related Work

- Part of project `20260215.01.persistent-session-workspace` (T01 of 7 tasks)
- Builds toward T03 (Daytona volume lifecycle) and T06 (safe resume fast-path)
- Related to `2026-02-15-175226-fix-post-approval-execution-hangs` which identified the root cause motivating this work

---

**Status**: ✅ Production Ready
**Timeline**: T01 complete; T02-T07 pending
