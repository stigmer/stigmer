# Next Task: Agent Runner Local Mode

**Project**: Agent Runner Local Mode  
**Location**: `_projects/2026-01/20260119.01.agent-runner-local-mode/`  
**Current Task**: T3 - Update Agent Runner main to connect to Stigmer Daemon gRPC

## Quick Context

Implementing local execution mode (`MODE=local`) for Agent Runner:
- Replace Daytona with host-level filesystem execution
- Remove cloud infrastructure dependencies (Auth0, Redis, Cloudflare)
- CLI supports both local mode (new) and cloud mode (existing)
- MODE (local/cloud) is separate from ENV (dev/staging/prod)

## Completed: T1 - Implement `execute()` in FilesystemBackend ✅

Successfully implemented shell command execution in Graphton's FilesystemBackend:
- Created `graphton/core/backends/` directory with enhanced FilesystemBackend
- Implemented `execute()` method using `subprocess.run()`
- Added comprehensive test suite (10 tests - all passing)
- All existing Graphton tests (163) still passing
- Updated sandbox_factory to use local backend

## Completed: T2 - Update Agent Runner config for local mode detection ✅

Successfully updated Agent Runner configuration for local/cloud mode switching:
- **Location**: `stigmer/backend/services/agent-runner/worker/config.py` (OSS repo)
- Updated `Config` class to detect `MODE=local` environment variable
- Added `mode`, `sandbox_type`, and `sandbox_root_dir` fields for local mode
- Made Redis configuration optional (None in local mode)
- Created `get_sandbox_config()` method that returns appropriate config based on mode
- Added `is_local_mode()` helper method for mode detection
- Updated `execute_graphton.py` to use config-driven sandbox configuration
- In local mode: sandbox manager bypassed, config passed directly to Graphton
- In cloud mode: existing Daytona sandbox manager behavior preserved
- Skills temporarily disabled in local mode (future enhancement)
- Clear separation: MODE (local/cloud) vs ENV (dev/staging/prod)

## Current Task: T3 - Update Agent Runner main to connect to Stigmer Daemon gRPC

**Objective**: Replace cloud service connections with Stigmer Daemon gRPC in local mode.

**Location**: `stigmer-cloud/backend/services/agent-runner/worker/worker.py` and `main.py`

**What to do**:
1. Update worker initialization to skip Redis when `MODE=local`
2. Connect to `STIGMER_BACKEND_ENDPOINT` (localhost:50051) in local mode
3. Connect to Redis in cloud mode (existing behavior)
4. Skip Auth0 validation when `MODE=local`
5. Handle gRPC streaming for workflow events
6. Proper error handling for connection failures

**Reference**: See ADR in `_cursor/adr-doc` (section 2: Configuration & Dependencies)

**Note**: Use `MODE` environment variable, not `ENV` (which is for dev/staging/prod)

## Next Steps After T3

- T4: Implement secret injection in Stigmer CLI/Daemon
- T5: End-to-end testing and validation

## Files

- `README.md` - Project overview
- `tasks.md` - All tasks with detailed requirements
- `notes.md` - Quick notes and learnings
- `next-task.md` - This file (drag into chat to resume!)

---

**To resume**: Just drag this file into any chat or reference: `@_projects/2026-01/20260119.01.agent-runner-local-mode/next-task.md`
