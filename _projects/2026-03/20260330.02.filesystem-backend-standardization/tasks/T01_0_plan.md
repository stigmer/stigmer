# Task T01: Fix Daytona Shell Execution Path

**Created**: 2026-03-30
**Status**: COMPLETE
**Type**: Bug fix / Refactoring
**Estimated effort**: ~1 session

This task addresses Gaps 1, 2, and 3 from the gap analysis — the critical, user-visible failures where shell execution in Daytona mode runs from the wrong directory.

## Problem Statement

`WorkspaceNormalizingBackend.execute()` sends commands to the inner `DaytonaBackend` (from `deepagents_cli`) without setting the working directory to the workspace root. File operations work because they go through `_normalize()` which adds the rebase prefix, but `execute()` does not.

Observable symptoms:
- `list .stigmer/skills/skill-creator/scripts` succeeds (file tool — normalized path)
- `execute "ls .stigmer/skills/skill-creator/scripts/"` fails (shell — wrong cwd)
- `glob` and `grep` also fail because they shell out via `execute`

## Root Cause

The setup backend (`DaytonaWorkspaceBackend`) prefixes every command with `cd {workspace_root} && ...`. The agent runtime backend (`WorkspaceNormalizingBackend`) does not. The inner `DaytonaBackend` runs from the sandbox root (`/home/daytona`), not the workspace root (`/home/daytona/workspace`).

Additionally, `STIGMER_PLATFORM_DIR` is never injected into the agent's `env_vars` in Daytona mode, making `resolve_platform_command` dead code. In Daytona mode `.stigmer/` is a real directory (not a virtual mount), so fixing the cwd is the primary fix.

## Scope

### What changes
- `WorkspaceNormalizingBackend.execute()` in `graphton/.../backends/daytona.py` — add `cd {workspace_root} &&` preamble
- Verify `glob` and `grep` tools work correctly after the fix (they shell out via `execute`)

### What does NOT change
- `FilesystemBackend` (local mode) — already correct
- `DaytonaWorkspaceBackend` (setup backend) — already has the `cd` prefix
- File operation methods on `WorkspaceNormalizingBackend` (`read`, `write`, `list_files`, etc.) — already normalized
- The `resolve_platform_command` regex — unchanged
- Proto definitions, RPCs, collections — zero changes
- Prompt content — no changes needed

## Implementation Plan

1. **Modify `WorkspaceNormalizingBackend.execute()`** to prefix commands with `cd {workspace_root} &&`, matching `DaytonaWorkspaceBackend.execute()`:
   - Env exports come first (via `;`), then `cd` (via `&&`) gates the user command
   - Final shape: `export FOO='bar'; cd '/home/daytona/workspace' && <user_command>`

2. **Research**: Check if the inner `DaytonaBackend` (deepagents_cli) has `execute_streaming`. If it does, `__getattr__` would bypass our fix (addressed fully in T02, but we should at minimum guard it here).

3. **Verify** `glob` and `grep` tools work with the fix — they build `find` / `grep` commands with relative paths.

4. **Test**: Run existing Daytona backend tests, add test for execute cwd behavior.

## Files to modify

- `backend/libs/python/graphton/src/graphton/core/backends/daytona.py` (primary change)
- Tests for the Daytona backend

## Success Criteria

- `execute "pwd"` returns the workspace root (not sandbox home) in Daytona mode
- `execute "ls .stigmer/skills/..."` succeeds when files exist
- `glob` and `grep` find files under `.stigmer/` in Daytona mode
- Existing tests pass

## Dependencies

- None — this is a standalone fix

## Next Task Preview

**T02: Harden WorkspaceNormalizingBackend Wrapper** — seal the `__getattr__` escape hatch, add explicit `execute_streaming`, audit all forwarded methods, address multiple backend instances.

---

# Project Task Overview

This project has 4 tasks. Each can be picked independently, but they build on each other in order of severity:

## T01: Fix Daytona Shell Execution Path (THIS TASK)
**Gaps**: 1 (no cwd), 2 (STIGMER_PLATFORM_DIR dead code), 3 (glob/grep broken)
**Severity**: Critical — immediate user-visible failures
**Effort**: ~1 session

## T02: Harden WorkspaceNormalizingBackend Wrapper
**Gaps**: 4 (__getattr__ bypass), 5 (multiple backend instances)
**Severity**: High — architectural safety
**Effort**: ~1 session

- Seal `__getattr__` so `execute_streaming` and other sensitive methods cannot bypass normalization
- Audit every method on the inner `DaytonaBackend` that could be forwarded
- Research whether multiple `create_sandbox_backend` calls per execution are intentional or accidental
- Consider shared backend instance or shared cache approach

## T03: Unify Tool Error Handling and Contracts
**Gaps**: 6 (bytes vs str), 7 (error handling), 10 (delete vs rm split)
**Severity**: Medium — inconsistent LLM experience
**Effort**: ~1-2 sessions

- Standardize error handling: all tools use `enrich_error_message` consistently
- Fix `edit` tool's missing `WriteResult.error` check
- Unify write API types (`bytes` vs `str`) or add a clear adapter layer
- Standardize `delete` tool behavior (consider supporting directory deletion)
- Normalize success message formats across tools

## T04: Consolidate Platform Mount and Display Humanization
**Gaps**: 8 (duplicated modules), 9 (humanization inconsistency), 11 (setup env vars)
**Severity**: Low-Medium — tech debt and cosmetic gaps
**Effort**: ~1 session

- Eliminate duplicated `platform_mount.py` (make worker copy import from graphton, or extract shared package)
- Fix `create_args_preview` to apply `humanize_sandbox_paths` like `humanize_args_for_display` does
- Humanize nested dict/list values in tool args, not just top-level strings
- Add missing env vars to `DaytonaWorkspaceBackend.execute` (setup backend)
