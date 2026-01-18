# Next Task: Agent Runner Local Mode

**Project**: Agent Runner Local Mode  
**Location**: `_projects/2026-01/20260119.01.agent-runner-local-mode/`  
**Current Task**: T2 - Update Agent Runner config for local mode detection

## Quick Context

Implementing local execution mode (`ENV=local`) for Agent Runner:
- Replace Daytona with host-level filesystem execution
- Remove cloud infrastructure dependencies (Auth0, Redis, Cloudflare)
- CLI supports both local mode (new) and cloud mode (existing)

## Completed: T1 - Implement `execute()` in FilesystemBackend ✅

Successfully implemented shell command execution in Graphton's FilesystemBackend:
- Created `graphton/core/backends/` directory with enhanced FilesystemBackend
- Implemented `execute()` method using `subprocess.run()`
- Added comprehensive test suite (10 tests - all passing)
- All existing Graphton tests (163) still passing
- Updated sandbox_factory to use local backend

## Current Task: T2 - Update Agent Runner config for local mode detection

**Objective**: Add local mode detection and configuration in Agent Runner.

**Location**: Agent runner config files (need to locate in Stigmer or separate repo)

**What to do**:
1. Find Agent Runner configuration code
2. Detect `ENV=local` environment variable
3. Return filesystem backend config when local:
   ```python
   {
     "type": "filesystem",
     "root_dir": "./workspace"
   }
   ```
4. Return Daytona config when cloud (existing behavior)
5. Skip cloud-specific config (Auth0, Redis, etc.) in local mode

**Reference**: See ADR in `_cursor/adr-doc` (section 2: Configuration & Dependencies)

## Next Steps After T2

- T3: Update Agent Runner main to connect to Stigmer Daemon gRPC
- T4: Implement secret injection in Stigmer CLI/Daemon
- T5: End-to-end testing and validation

## Files

- `README.md` - Project overview
- `tasks.md` - All tasks with detailed requirements
- `notes.md` - Quick notes and learnings
- `next-task.md` - This file (drag into chat to resume!)

---

**To resume**: Just drag this file into any chat or reference: `@_projects/2026-01/20260119.01.agent-runner-local-mode/next-task.md`
