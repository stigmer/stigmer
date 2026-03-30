# Filesystem Backend Standardization

**Date**: March 30, 2026

## Summary

Brought the filesystem/workspace abstraction layer to the same architectural standard as the HITL flow. Four tasks eliminated inconsistencies between local and Daytona backends: fixed broken shell execution in Daytona mode, sealed leaky abstractions, unified tool error handling, and consolidated duplicated modules with consistent display humanization.

## Problem Statement

The agent runtime's filesystem layer had divergent behavior between local and Daytona (cloud sandbox) backends. Shell commands ran from the wrong directory in Daytona mode, `__getattr__` leaked raw inner-backend methods past the normalizing wrapper, tool error handling was inconsistent across tools, and display humanization had gaps that caused absolute sandbox paths to leak into the UI.

### Pain Points

- `execute "ls .stigmer/skills/"` failed in Daytona mode (wrong cwd), while the equivalent file-tool call succeeded
- `glob` and `grep` tools failed in Daytona because they shell out via `execute`
- `__getattr__` forwarded sensitive inner-backend methods (bypassing path normalization), creating a latent path-normalization bug in `upload_files`/`download_files`
- `edit` tool silently swallowed write failures (missing `.error` check)
- `delete` tool had two identical exception handlers and leaked backend result strings
- `create_args_preview` showed raw `/home/daytona/workspace/...` paths in the UI while `humanize_args_for_display` correctly shortened them
- `humanize_args_for_display` only humanized top-level strings, ignoring nested dicts/lists
- Two copies of `platform_mount.py` (105 + 273 lines) maintained manually in sync

## Solution

Four sequential tasks, each building on the previous:

1. **T01** -- Fixed Daytona shell execution by adding `cd {workspace_root} &&` preamble to `WorkspaceNormalizingBackend.execute()`, with an explicit `execute_streaming` override to prevent `__getattr__` bypass.
2. **T02** -- Sealed the `__getattr__` escape hatch entirely, replacing open forwarding with `AttributeError` for undefined attributes. Added explicit `id` property as the only legitimate pass-through.
3. **T03** -- Unified tool error handling contracts: tool wrappers own user-facing responses, backends own operations, wrappers defensively check results. Fixed `edit`, `delete`, and `grep` tools.
4. **T04** -- Consolidated duplicated `platform_mount.py` into a re-export module, extracted `_humanize_display_string` as the single humanization pipeline, added env var infrastructure to the Daytona setup backend.

## Implementation Details

### Shell Execution Fix (T01)
- `WorkspaceNormalizingBackend.execute()` now prepends `cd {workspace_root} &&` with env var exports, matching the setup backend's behavior
- Explicit `execute_streaming()` override prevents `__getattr__` from leaking the inner backend's raw method

### Sealed Wrapper (T02)
- `__getattr__` replaced with a version that raises `AttributeError` for any attribute not explicitly defined
- Fixed a latent bug: `DeepAgentsBackendAdapter.upload_files`/`download_files` were resolving to raw Daytona `sandbox.fs` methods via `__getattr__`, bypassing path normalization

### Error Handling Contracts (T03)
- `edit` tool: added `getattr(result, "error", None)` check after `backend.write()`
- `delete` tool: owns its success message (`f"Deleted '{path}'"`) instead of passing backend result through
- `grep` tool: routes invalid regex through `enrich_error_message` for consistent format

### Platform Mount Consolidation (T04)
- Worker copy of `platform_mount.py` reduced from 105 lines to 15 (re-exports from graphton)
- `_humanize_display_string()` applies the full 3-step pipeline: platform refs -> env vars -> sandbox paths
- Both `humanize_args_for_display` and `create_args_preview` now recurse into nested structures and apply identical humanization
- `DaytonaWorkspaceBackend.execute()` now exports `PYTHONUNBUFFERED=1`, uses `shlex.quote`, and supports env var injection for Phase B

## Benefits

- All file operations (read, write, edit, delete, ls, glob, grep, execute) now behave identically across local and Daytona backends
- Shell commands run from the correct workspace root in both modes
- No raw sandbox paths leak into the UI -- consistent display humanization at every depth
- Single source of truth for platform mount logic (one module, not two)
- Env var infrastructure ready for Phase B cloud-mode virtual mount without additional code changes
- Sealed wrapper prevents future accidental method leakage as the inner backend evolves

## Impact

- **Agent runtime**: Shell execution, glob, and grep tools now work correctly in Daytona cloud mode
- **UI/UX**: Tool call args and previews show clean, relative paths instead of raw sandbox internals
- **Maintainability**: Duplicated module eliminated, humanization pipeline unified, error handling consistent
- **Forward compatibility**: Env var infrastructure and sealed wrapper provide clean extension points

## Related Work

- Builds on the HITL flow standardization that established the Single Source of Truth and Direct Identity principles
- `DaytonaWorkspaceBackend` env var infrastructure prepares for Phase B (cloud-mode virtual platform mount)
- 3 redundant `create_sandbox_backend` calls per Daytona execution identified but deferred (functionally correct, consolidation requires signature changes)

---

**Status**: Production Ready
**Timeline**: 1 day (4 tasks across 3 sessions)
