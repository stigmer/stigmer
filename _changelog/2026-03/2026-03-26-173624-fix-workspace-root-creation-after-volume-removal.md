# Fix Workspace Root Creation After Volume Removal

**Date**: March 26, 2026

## Summary

Fixed workspace provisioning failure caused by missing `/home/daytona/workspace` directory after the Daytona volume removal. The `DaytonaWorkspaceBackend` now guarantees its own workspace root directory exists at construction time via an idempotent `mkdir -p` call.

## Problem Statement

After removing FUSE+S3 volume mounts (commit `164549dc`), every agent execution targeting a git repository failed at workspace provisioning with:

```
cd: no such file or directory: /home/daytona/workspace
```

### Pain Points

- All agent executions with git workspace entries were broken in production
- The error surfaced deep in the call chain (`daytona.py:execute()` -> `cd /home/daytona/workspace && git clone ...`), making the root cause non-obvious from the error message alone
- The previous volume mount implicitly created the directory as a mount point — a side effect that was invisible until removed

## Solution

Made `DaytonaWorkspaceBackend` self-sufficient: the constructor runs `sandbox.process.exec("mkdir -p {workspace_root}")` immediately after path validation. This enforces the invariant that `workspace_root` exists operationally, not just syntactically.

The `mkdir -p` pattern is already established within the class (`write_file`, `write_files`, `mkdir` all use it), so this follows the existing convention.

## Implementation Details

### Production code (2 files)

1. **`worker/workspace/daytona.py`** — Added `_ensure_workspace_root()` method called from `__init__`. Uses `sandbox.process.exec` (not the session API, which isn't created yet at that point). Class docstring updated to document the new invariant.

2. **`worker/sandbox_manager.py`** — Updated `DAYTONA_WORKSPACE_MOUNT_PATH` constant documentation to reflect the local overlay reality. Marked the dead-code volume state section with an explicit header so future engineers understand these functions are intentionally preserved but inactive.

### Test code (1 file)

3. **`tests/workspace/test_daytona_backend.py`** — Added `test_creates_workspace_root_directory` verifying `mkdir -p` is the first `process.exec` call during construction. Fixed `TestMkdir.test_creates_directory` to reset the mock after construction so it correctly asserts only the mkdir-under-test.

### Why `__init__` and not elsewhere

- Not `initialize_workspace()` — factory shouldn't know about directory creation details
- Not `_create_daytona_sandbox()` — only runs for new sandboxes; reused sandboxes (STOPPED/ARCHIVED recovery) also need the directory
- Not `_ensure_session()` — session creation is about the Daytona process session API, not filesystem bootstrap
- Not `execute()` — wasteful to check every time; `mkdir -p` only needs to run once

## Benefits

- **Workspace provisioning works again** — The immediate production blocker is resolved
- **Backend is self-sufficient** — `DaytonaWorkspaceBackend` guarantees its own operational invariants without relying on external directory creation
- **Stale documentation cleaned up** — Comments no longer reference volume mounts that were removed

## Impact

- **Agent executions**: All git-based workspace provisioning is unblocked
- **Existing tests**: All 54 tests pass (24 daytona backend + 30 sandbox manager)
- **No structural changes**: Provisioning flow, workspace resolution logic, and `is_local_mode` flag behavior are unchanged

## Related Work

- Volume removal: `_changelog/2026-03/2026-03-26-170950-remove-daytona-volume-dependency-clone-to-local-fs.md`
- RCA report: `_cursor/daytona-rca-report.md`

---

**Status**: ✅ Production Ready
**Timeline**: Fix completed in a single session
