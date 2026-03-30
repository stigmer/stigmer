# Next Task: 20260330.02.filesystem-backend-standardization

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260330.02.filesystem-backend-standardization

**Description**: Bring the filesystem/workspace abstraction layer to the same architectural standard as the HITL flow — eliminate inconsistencies between local and Daytona backends, fix broken shell execution in Daytona mode, seal leaky abstractions, and unify tool error handling across all LLM file/execute tools.
**Goal**: Ensure all file operations (read, write, edit, delete, ls, glob, grep, execute) behave identically across local and Daytona backends, with consistent path resolution, error handling, and display humanization — a unified filesystem experience regardless of deployment mode.
**Tech Stack**: Python (graphton library, agent-runner service), Daytona SDK (deepagents_cli)
**Components**: graphton core backends (filesystem.py, daytona.py, platform_mount.py), tool_wrappers.py, agent-runner workspace backends (local.py, daytona.py, __init__.py), setup.py, subagent_transformer.py, handlers/tool_event.py

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.02.filesystem-backend-standardization/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-30 17:34
**Current Task**: T02 (Harden WorkspaceNormalizingBackend Wrapper)
**Status**: Ready to start T02

## Session Progress (2026-03-30)

### T01: Fix Daytona Shell Execution Path -- COMPLETE

**What was accomplished:**
- Added `cd {workspace_root} &&` preamble to `WorkspaceNormalizingBackend.execute()` so shell commands run from the workspace root instead of the sandbox root
- Added explicit `execute_streaming()` override to prevent `__getattr__` from leaking the inner backend's raw method (bypassing the cd fix)
- Added `asyncio` and `Callable` imports to support the async streaming override

**Test-driven research findings:**
- Confirmed via live integration test that `DaytonaBackend` (deepagents_cli) does NOT have `execute_streaming` as of current version
- Added canary test that will flag if a future deepagents_cli release adds it

**Tests added/updated:**
- Updated `test_execute_not_normalised` -> `test_execute_prepends_cd_to_workspace_root`
- Added `TestExecuteCwd` (5 unit tests): rebase, env_vars ordering, platform resolution, no env, kwargs forwarding
- Added `TestExecuteStreamingCwd` (4 unit tests): cd preamble, rebase+env, sync fallback, __getattr__ leak prevention
- Added `TestDaytonaBackendApiSurface` (1 integration test): execute_streaming presence canary
- Added `TestExecuteCwdOnDaytona` (4 integration tests): pwd, ls .stigmer/, find, grep

**Results:** 94/94 unit tests pass, 28/28 integration tests pass against live Daytona sandbox

**Files modified:**
- `backend/libs/python/graphton/src/graphton/core/backends/daytona.py` (+69/-13)
- `backend/libs/python/graphton/tests/core/test_daytona_backend.py` (+188/-1)
- `backend/libs/python/graphton/tests/integration/test_daytona_sandbox_tools.py` (+102)

## Next Steps

1. **Start T02**: Harden WorkspaceNormalizingBackend Wrapper -- seal `__getattr__` escape hatch, audit all forwarded methods, research multiple backend instances
2. **T03**: Unify Tool Error Handling and Contracts
3. **T04**: Consolidate Platform Mount and Display Humanization

## Context for Resume

- T01 fix is minimal and surgical: one production file changed, two test files updated
- The `write()` and `delete()` methods intentionally call `self._inner.execute()` directly (not `self.execute()`) because they pass normalized/rebased paths -- do NOT change this in T02
- `shlex.quote()` on simple paths like `/workspace` returns them bare (no quotes added) -- tests must match this behavior
- Pre-existing test failures exist in `test_tool_wrappers.py` (broken import), `test_prompt_enhancement.py` (word count), `test_recursion_limit.py` (substring mismatch) -- these are NOT caused by T01

## Quick Commands

After loading context:
- "Start T02" - Begin the next task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
