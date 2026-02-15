# Next Task: 20260215.01.persistent-session-workspace

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260215.01.persistent-session-workspace

**Description**: Implement session-scoped persistent workspace using Daytona volumes and local session directories, ensuring agent execution resumes seamlessly after approval regardless of sandbox lifecycle.
**Goal**: Make post-approval execution resumption correct by construction — workspace files persist via Daytona volumes (cloud) and session-scoped directories (local), independent of sandbox lifecycle.
**Tech Stack**: Python, Daytona SDK, Protocol Buffers, Go (Temporal workflow)
**Components**: agent-runner service (sandbox_manager, execute_graphton, config), graphton library (backends, sandbox_factory), session proto, Temporal workflow

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260215.01.persistent-session-workspace/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-15 18:35
**Current Task**: T03 (Sandbox Restart/Recovery Before Recreation)
**Status**: In Progress (T01 ✅, T02 ✅)
**Last Session**: 2026-02-15 20:29 — Completed T02 (Daytona volume initialization at worker startup)

## Session Progress (2026-02-15, Evening Session)

### What Was Accomplished
- ✅ **T02 Completed**: Daytona volume initialization at worker startup
- Module-level volume_id store in `sandbox_manager.py` (following `token_manager.py` pattern)
- Worker startup integration in `AgentRunner.__init__` (following Redis init pattern)
- Volume mounting in `_create_daytona_sandbox` with session-scoped subpaths
- Activity wiring in `execute_graphton.py` to read and pass volume_id
- Zero linter errors, all todos completed

### Key Decisions Made
- **Runner-startup approach chosen over per-activity**: Volume initialization happens once at worker startup alongside Redis, not per-execution
- **Module-level store pattern**: Volume ID shared across activities via `get_daytona_volume_id()` (same pattern as API key)
- **Fail-fast on errors**: Worker won't start if volume initialization fails (intentional — workspace persistence is non-negotiable)
- **Backward compatible**: Local mode unaffected, ephemeral sandboxes (session_id=None) still supported

### Files Modified
- `worker/sandbox_manager.py` (+133 lines): Volume store, initialization function, VolumeMount construction
- `worker/worker.py` (+43 lines): `_initialize_daytona_volume()` method, cloud-mode init block
- `worker/activities/execute_graphton.py` (+7 lines): Import `get_daytona_volume_id`, pass to constructor
- Changelog: `_changelog/2026-02/2026-02-15-202923-daytona-volume-worker-startup.md`

### Committed
- ✅ `6b654888` — feat(backend/agent-runner): initialize Daytona volume at worker startup

## Next Steps

1. **T03**: Sandbox restart/recovery before recreation (independent, can start immediately)
2. **T04**: Backend workspace root from volume mount path (depends on T02 ✅)
3. **T05**: Simplify resume fast-path with volume safety checks (depends on T04)
4. **T06**: Testing — comprehensive validation after all implementation complete

## Context for Resume

- **T02 is complete**: Volume infrastructure is in place, ready to be used by new sandboxes
- **T03 is independent**: Sandbox restart logic doesn't require volume changes
- **Surprising discovery during planning**: The original plan had T02 as "add volume_id to proto", but that was revised to "volume initialization at worker startup" based on the design decision that volume is worker-level, not session-level
- Volume mount path: `/home/daytona/workspace` with subpath `sessions/{session_id}`
- Volume name configurable via `DAYTONA_VOLUME_NAME` (default: `stigmer-workspaces`)

## Quick Commands

After loading context:
- "Continue with T02" - Start the proto change in stigmer-cloud
- "Continue with T04" - Start sandbox restart/recovery (independent)
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
