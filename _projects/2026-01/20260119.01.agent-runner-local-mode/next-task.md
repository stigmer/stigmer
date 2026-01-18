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

## Completed: T3 - Update Agent Runner main to connect to Stigmer Daemon gRPC ✅

Successfully updated Agent Runner to support local/cloud mode switching:

**Location**: `stigmer/backend/services/agent-runner/worker/` (OSS repo)

**Changes Made**:

1. **worker.py**:
   - Added Redis initialization that only runs in cloud mode
   - Skips Redis in local mode (logs message about using gRPC to Stigmer Daemon)
   - Added `_initialize_redis()` method with proper error handling
   - Enhanced logging to show execution mode, backend endpoint, and sandbox type
   - Added `shutdown()` method to properly close Redis connections
   - Added try/except blocks for Temporal connection with clear error messages

2. **main.py**:
   - Added startup banner showing mode (LOCAL/CLOUD) and configuration
   - Improved error handling for config loading
   - Removed reference to non-existent `rotation_task`
   - Simplified shutdown handler to use new `worker.shutdown()` method
   - Added better exception handling and logging

**How It Works**:
- In **local mode**: 
  - Redis initialization is skipped
  - gRPC client connects to `STIGMER_BACKEND_ENDPOINT` (localhost:50051)
  - Auth uses "dummy-local-key" (server-side validation not enforced)
  - Filesystem sandbox is used

- In **cloud mode**:
  - Redis is initialized and connected
  - gRPC client connects to cloud backend
  - Full Auth0 validation via API key
  - Daytona sandbox is used

**Note**: gRPC client (AgentExecutionClient) already uses config-based endpoint selection, so no changes were needed there. Auth validation relaxation happens via the "dummy-local-key" being accepted in local mode.

## Current Task: T4 - Implement secret injection in Stigmer CLI/Daemon

**Objective**: Update the Go-based Stigmer CLI/Daemon to prompt for and inject API keys at runtime.

**Location**: TBD - Likely `stigmer-cloud` repo

**What to do**:
1. Create `stigmer local start` command in Go CLI
2. Detect missing `ANTHROPIC_API_KEY` environment variable
3. Prompt user for API key (masked input)
4. Spawn Agent Runner subprocess with injected environment
5. Handle supervisor lifecycle (start/stop/restart)

**Reference**: See ADR in `_cursor/adr-doc` (section 4: Secret Management)

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
