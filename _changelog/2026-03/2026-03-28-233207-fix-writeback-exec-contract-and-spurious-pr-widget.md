# Fix Writeback Coordinator ExecuteResponse Contract Mismatch

**Date**: March 28, 2026

## Summary

Fixed the "Pull Requests" widget incorrectly appearing with "Failed" status when no file-modifying tools were used during agent execution. The root cause was `writeback_coordinator._exec` calling `sandbox.process.exec()` directly and accessing `.stdout` on a Daytona `ExecuteResponse` that only has `.output`. Also hardened the exception handler to suppress spurious FAILED writeback status entries when the error occurs before any git mutation.

## Problem Statement

When an agent execution ran only read-only or `execute` (shell) tools against a git-backed workspace — with no `write` or `edit` tool calls — the UI's "Pull Requests" sidebar widget still appeared showing two "Failed" entries with the error `'ExecuteResponse' object has no attribute 'stdout'`.

### Pain Points

- The widget appeared even though no files were modified, no branch was created, and no PR was opened
- The error message (`'ExecuteResponse' object has no attribute 'stdout'`) was confusing to users
- This is the same class of bug that was fixed on March 26 in `tool_wrappers.py` and `daytona.py`, but the writeback coordinator was missed because it bypasses both the graphton backend and workspace backend normalization layers

### Root Cause

The `_exec` helper in `writeback_coordinator.py` had two code paths:
- **Sandbox path**: called `sandbox.process.exec()` which returns Daytona SDK's `ExecuteResponse` with `.output` (no `.stdout`)
- **Backend path**: called `workspace_backend.execute()` which returns `ExecuteResult` with `.stdout`

All downstream methods (`_has_changes`, `_create_branch`, `_commit_and_push`, etc.) accessed `.stdout`, causing an `AttributeError` on the sandbox path. The error was caught by the generic exception handler which defensively emitted a `FAILED` `WorkspaceWriteBack` status entry — causing the widget to appear.

## Solution

Two targeted fixes in the writeback coordinator:

1. **Normalize `_exec` return type**: Translate `sandbox.process.exec()` results into `ExecuteResult` using `getattr` with `.output` fallback, matching the pattern established in `to_execution_result()` from `graphton/core/backends/types.py`.

2. **Guard the exception handler**: Track whether a git mutation was attempted via a `mutation_started` flag. Pre-mutation errors (e.g., `_has_changes()` failing) are logged but do not emit a `FAILED` writeback status. Post-mutation errors (branch creation, commit, push, PR) still correctly emit FAILED status so the user knows their changes may need manual attention.

## Implementation Details

### `_exec` normalization (`writeback_coordinator.py`)

The sandbox path now wraps the raw Daytona response:

```python
def _exec(cmd: str, timeout: int = 15) -> ExecuteResult:
    full_cmd = f"cd {root_dir} && {cmd}"
    if self._sandbox is not None:
        raw = self._sandbox.process.exec(full_cmd, timeout=timeout)
        return ExecuteResult(
            exit_code=getattr(raw, "exit_code", 1),
            stdout=getattr(raw, "stdout", None) or getattr(raw, "output", None) or "",
            stderr=getattr(raw, "stderr", "") or "",
        )
    return self._workspace_backend.execute(full_cmd, timeout=timeout)
```

### Exception handler guard (`writeback_coordinator.py`)

```python
mutation_started = False
try:
    if not self._has_changes(_exec):
        return
    mutation_started = True
    # ... branch, commit, push, PR ...
except Exception as exc:
    if not mutation_started:
        return  # pre-mutation error — no writeback status needed
    # ... emit FAILED writeback ...
```

### Test coverage (`tests/test_writeback_coordinator.py`)

10 new tests covering:
- `_exec` normalization: `.output` mapped to `.stdout`, real `.stdout` preferred over `.output`
- `_has_changes`: correct detection of unstaged diffs, staged diffs, untracked files, and clean state
- `finalize()` on clean workspace: no writeback emitted via both sandbox and backend paths
- Exception handler guard: pre-mutation errors suppressed, post-mutation errors correctly emit FAILED

## Benefits

- Users no longer see a confusing "Failed" PR widget when no files were modified
- The writeback coordinator now has the same Daytona SDK compatibility as the rest of the platform
- Pre-mutation errors are handled silently rather than polluting the UI
- Post-mutation errors still surface correctly for genuine failures

## Impact

- **Agent executions on Daytona sandboxes**: Fixed — `finalize()` no longer crashes when checking for changes
- **UI "Pull Requests" widget**: No longer appears spuriously on read-only or execute-only sessions
- **Local filesystem mode**: Unaffected — workspace backend already returned `ExecuteResult`

## Related Work

- [Fix Execute Tool Backend Contract Mismatch](2026-03-26-201008-fix-execute-tool-backend-contract-mismatch.md) — Same `.stdout` vs `.output` class of bug, fixed in graphton's tool_wrappers.py and daytona adapter
- [Incremental Git Write-back and Artifact Staleness](2026-03-28-162537-incremental-git-writeback-and-artifact-staleness.md) — Introduced the `WriteBackCoordinator` and incremental write-back flow

---

**Status**: ✅ Production Ready
