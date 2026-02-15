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
**Current Task**: T04 (Backend Workspace Root from Volume Mount)
**Status**: In Progress (T01 ✅, T02 ✅, T03 ✅)
**Last Session**: 2026-02-15 20:45 — Completed T03 (Sandbox restart/recovery before recreation)

## Session Progress (2026-02-15, Session 2 — Evening)

### What Was Accomplished
- ✅ **T03 Completed**: Sandbox restart/recovery before recreation
- New `_try_revive_daytona_sandbox()` method — state-aware recovery chain handling STARTED, STOPPED, ARCHIVED, ERROR, DESTROYED, and all transitional states
- Updated `get_or_create_daytona_sandbox()` caller with typed `DaytonaNotFoundError` handling
- Added `auto_delete_interval=-1` to sandbox creation params
- Discovered `SandboxState` enum has 16 members (not 4-5 as documented)
- Zero linter errors, module imports verified

### Key Decisions Made
- **One attempt per state, no retry loops**: Simple and safe — volume guarantees file survival
- **STARTED still gets health check**: Defense-in-depth for stale SDK state
- **Transitional states fall through**: STARTING, STOPPING, etc. are rare; no complex wait logic
- **`auto_delete_interval=-1`**: Explicit at creation time even though SDK default is disabled
- **`DaytonaNotFoundError`**: Typed error instead of bare `Exception` for "sandbox gone" case

### Files Modified
- `worker/sandbox_manager.py` (+195 net lines): Recovery chain, typed errors, auto-lifecycle params
- Changelog: `_changelog/2026-02/2026-02-15-204533-sandbox-restart-recovery-before-recreation.md`

### Committed
- ✅ `6b654888` — feat(backend/agent-runner): initialize Daytona volume at worker startup (T02)
- ✅ T03 commit (this session)

## Next Steps

1. **T04**: Backend workspace root from volume mount path (depends on T02 ✅, ready to start)
2. **T05**: Simplify resume fast-path with volume safety checks (depends on T04)
3. **T06**: Testing — comprehensive validation after all implementation complete

## Context for Resume

- **T01-T03 are complete**: Local session dirs, volume infrastructure, and sandbox recovery are in place
- **T04 is the next logical step**: Wire the volume mount path (`/home/daytona/workspace`) into the graphton backend as the workspace root, so the agent's file operations target the persistent volume
- **Key files for T04**:
  - `backend/libs/python/graphton/src/graphton/core/backends/daytona.py` — workspace root from config
  - `backend/services/agent-runner/worker/activities/execute_graphton.py` — pass mount path
- Volume mount path: `/home/daytona/workspace` with subpath `sessions/{session_id}`
- Volume name configurable via `DAYTONA_VOLUME_NAME` (default: `stigmer-workspaces`)
- **Surprising discovery in T03**: `SandboxState` has 16 enum members including DESTROYED (not DELETED), plus 10 transitional states like STARTING, STOPPING, ARCHIVING, etc.

## Quick Commands

After loading context:
- "Continue with T04" - Start backend workspace root wiring
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
