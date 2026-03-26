# Fix Daytona Sandbox stdout/stderr Capture in WorkspaceBackend

**Date**: March 26, 2026

## Summary

Fixed two critical bugs in `DaytonaWorkspaceBackend.execute()` where all stdout and stderr from sandbox commands were silently discarded due to a mismatch between the code's attribute reads and the Daytona SDK's actual API surface. Switched from Daytona's `process.exec()` (which only returns stdout via `result.result` and has no stderr) to `process.execute_session_command()` (which returns separate `stdout`, `stderr`, and combined `output`). Added explicit lifecycle management via a `close()` method on the `WorkspaceBackend` protocol.

## Problem Statement

The `DaytonaWorkspaceBackend.execute()` method was reading attributes that do not exist on the Daytona SDK's `ExecuteResponse` object, causing all command output to be silently lost. This made every sandbox command failure undiagnosable and broke several downstream features that depend on parsing command output.

### Pain Points

- Git clone failures in the sandbox produced `Detail: ` (empty) — no error message, no stderr, no way to determine whether the failure was network, auth, DNS, or disk-related
- Idempotent repo detection (`_detect_existing_repo`) was broken — the `echo yes` output was never captured, so every execution re-cloned even when the repo already existed in the sandbox
- Branch and commit resolution (`_resolve_branch`, `_resolve_head`) returned empty strings — `git rev-parse` stdout was discarded
- Post-execution git diff artifact generation produced empty diffs

### Root Cause (Two Bugs)

**Bug 1 — stdout lost:** The code read `getattr(result, "output", "")` but the Daytona SDK's `ExecuteResponse` has no `output` attribute. The correct attribute is `result.result`. The `getattr` fallback silently returned `""`.

**Bug 2 — stderr lost:** The code read `getattr(result, "stderr", "")` but `ExecuteResponse` has no `stderr` attribute at all. The Daytona SDK's `process.exec()` API does not capture stderr — it only returns stdout via the `result` field. This is a fundamental SDK limitation, not a code bug: `process.exec()` simply does not support stderr.

## Solution

Switched `DaytonaWorkspaceBackend.execute()` from `process.exec()` to Daytona's session-based execution API (`process.execute_session_command()`), which returns `SessionExecuteResponse` with separate `stdout`, `stderr`, and `exit_code` fields. This is the only Daytona SDK API that provides the stdout/stderr separation required by the `WorkspaceBackend` protocol.

A lightweight Daytona process session is created lazily on the first `execute()` call and deleted when `close()` is called. The `WorkspaceBackend` protocol was extended with a `close()` method (default no-op) so callers always clean up regardless of backend type.

## Implementation Details

### WorkspaceBackend Protocol (`backend.py`)

Added `close()` as the final method on the protocol with a default no-op `return`. This makes resource lifecycle explicit in the protocol contract without requiring changes to callers that don't need cleanup.

### LocalWorkspaceBackend (`local.py`)

Added explicit no-op `close()` for clarity. `LocalWorkspaceBackend.execute()` was already correct (uses `subprocess.run(capture_output=True)`) and required no changes.

### DaytonaWorkspaceBackend (`daytona.py`)

- **`__init__`**: Generates a unique session ID (`ws-provision-{uuid}`) and sets `_session_created = False` for lazy initialization.
- **`_ensure_session()`**: Creates the Daytona process session on first `execute()` call. Raises immediately on failure (fail-fast — a broken sandbox means nothing will work).
- **`execute()`**: Uses `process.execute_session_command()` with `SessionExecuteRequest`. Maps `SessionExecuteResponse.stdout`, `.stderr`, and `.exit_code` to `ExecuteResult`.
- **`close()`**: Deletes the session if one was created. Best-effort with warning on failure — a leaked session is non-catastrophic since the sandbox lifecycle handles cleanup.
- **Unchanged**: `write_file`, `write_files`, `file_exists`, `mkdir` still use `process.exec()` directly. These are simple utility commands that only need `exit_code`, not stdout/stderr parsing.

### Activity Cleanup (`execute_graphton.py`)

- Initialized `workspace_backend = None` before the try block (same pattern as `status_builder = None` for early-failure safety).
- Added `workspace_backend.close()` in the outermost `finally` block, before existing checkpointer and gRPC cleanup.

## Benefits

- Git clone failures now produce diagnostic error messages (auth errors, network errors, DNS failures) instead of empty `Detail:`
- Idempotent repo detection works correctly — re-cloning is avoided when the sandbox already has the repo
- Branch and commit resolution returns actual values from `git rev-parse`
- Post-execution git diff artifacts contain actual diff content
- The `WorkspaceBackend` protocol now has explicit lifecycle semantics

## Impact

- **Agent executions with git_repo workspaces**: All sandbox command output is now captured, making provisioning failures diagnosable and fixing broken idempotency/metadata resolution.
- **LocalWorkspaceBackend**: Unaffected — already correct.
- **WorkspaceBackend protocol consumers**: The new `close()` method has a default no-op, so existing consumers are unaffected unless they want cleanup.

## Related Work

- The `GITHUB_TOKEN` injection from personal environment ([2026-03-26-123838](2026-03-26-123838-inject-github-token-from-personal-environment.md)) was confirmed working by server-side logs. This fix addresses the separate issue of the agent-runner being unable to surface the actual error from the sandbox when the clone fails.
- Daytona SDK PR [#2241](https://github.com/daytonaio/daytona/pull/2241) (merged Sep 2025) added stdout/stderr separation to session command logs — `execute_session_command()` is the intended API for structured output capture.

---

**Status**: ✅ Production Ready
