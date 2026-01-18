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

## Completed: T4 - Implement secret injection in Stigmer CLI/Daemon ✅

Successfully implemented secret injection in the Stigmer CLI daemon:

**Location**: `stigmer/client-apps/cli/internal/cli/daemon/` (OSS repo)

**Changes Made**:

1. **secrets.go** (NEW):
   - Added `PromptForSecret()` function with masked terminal input (using golang.org/x/term)
   - Added `GetOrPromptSecret()` helper to check env or prompt
   - Added `GatherRequiredSecrets()` to collect all required secrets (ANTHROPIC_API_KEY)
   - Returns map of environment variables to inject

2. **daemon.go**:
   - Added `AgentRunnerPIDFileName` constant for agent-runner PID file
   - Updated `Start()` to:
     - Call `GatherRequiredSecrets()` before starting services
     - Start agent-runner subprocess after stigmer-server
     - Inject secrets into agent-runner environment
   - Added `startAgentRunner()` function:
     - Finds agent-runner script via `findAgentRunnerScript()`
     - Configures local mode environment (MODE=local, SANDBOX_TYPE=filesystem, etc.)
     - Injects gathered secrets into subprocess environment
     - Writes PID file for lifecycle management
     - Redirects output to separate log files (agent-runner.log, agent-runner.err)
   - Added `findAgentRunnerScript()` function:
     - Checks `STIGMER_AGENT_RUNNER_SCRIPT` environment variable
     - Searches default paths (backend/services/agent-runner/run.sh)
     - Returns absolute path to run script
   - Updated `Stop()` to call `stopAgentRunner()` before stopping server
   - Added `stopAgentRunner()` function:
     - Reads agent-runner PID file
     - Sends SIGTERM for graceful shutdown
     - Waits up to 5 seconds
     - Force kills if needed
     - Cleans up PID file

3. **Dependencies**:
   - Added golang.org/x/term for masked password input
   - Updated go.mod and go.sum

**How It Works**:

1. User runs `stigmer local start`
2. Daemon checks for `ANTHROPIC_API_KEY` in environment
3. If missing, prompts: `Enter Anthropic API key: ` (masked input)
4. Starts stigmer-server process
5. Starts agent-runner subprocess with:
   - Local mode configuration (MODE=local, filesystem sandbox)
   - Injected secrets from gathered map
   - Proper logging to agent-runner.log
6. Both processes run in background with PID files
7. `stigmer local stop` gracefully stops both processes

**Secret Injection Details**:
- Secrets only exist in process memory (never written to disk)
- Environment variables injected at subprocess spawn time
- No plaintext secrets in config files or version control

## Completed: T5 - Comprehensive documentation and changelog ✅

Successfully created complete documentation package:

**Documentation Created**:

1. **TESTING.md**:
   - Complete testing guide with all scenarios
   - Build instructions for CLI, stigmer-server, agent-runner
   - 5 test scenarios (fresh start, existing key, stop, restart, crash recovery)
   - Debugging guide with log inspection commands
   - Known issues and solutions
   - Success criteria checklist

2. **T4-IMPLEMENTATION-SUMMARY.md**:
   - Comprehensive architecture documentation
   - Before/after diagrams
   - Detailed function-by-function breakdown
   - Security considerations and trade-offs
   - User experience examples
   - Future enhancement ideas
   - References and related tasks

3. **Changelog**: `_changelog/2026-01/2026-01-19-032221-implement-secret-injection-local-mode.md`
   - Complete implementation changelog
   - Problem statement and solution overview
   - Detailed technical implementation
   - Security considerations
   - Integration points and related work
   - Future enhancements

**Implementation Complete**:
- ✅ Code compiles successfully (`go build`)
- ✅ Dependencies added (golang.org/x/term)
- ✅ All daemon functions implemented
- ✅ Secret prompting with masked input
- ✅ Agent-runner subprocess spawning
- ✅ Lifecycle management (start/stop/restart)
- ✅ PID file management
- ✅ Log file redirection
- ✅ Comprehensive documentation created
- ✅ Changelog documenting implementation

**Ready for Execution**:
The implementation is complete and ready for manual testing. Follow the steps in `TESTING.md` to:
1. Build binaries
2. Test secret prompting
3. Verify both processes start
4. Check logs and connectivity
5. Test graceful shutdown

**Next Steps**:
- Execute test scenarios from TESTING.md
- Fix any issues discovered during testing
- Create PR with all changes

## Project Status: ✅ COMPLETE

All tasks for Agent Runner Local Mode implementation are complete:

- ✅ **T1**: Implement `execute()` in FilesystemBackend (Graphton)
- ✅ **T2**: Update Agent Runner config for local mode detection
- ✅ **T3**: Update Agent Runner main to connect to Stigmer Daemon gRPC
- ✅ **T4**: Implement secret injection in Stigmer CLI/Daemon
- ✅ **T5**: Create comprehensive testing documentation

## Summary of Changes

### Graphton (graphton repo)
- Added `execute()` method to FilesystemBackend using `subprocess.run()`
- Created comprehensive test suite (10 tests, all passing)
- Updated sandbox_factory to use local backend

### Agent Runner (stigmer OSS repo)
- Updated config.py for MODE=local detection
- Made Redis optional (None in local mode)
- Added `get_sandbox_config()` for mode-based configuration
- Updated execute_graphton.py to use config-driven sandboxes
- Modified worker.py to skip Redis in local mode
- Enhanced main.py with startup banner and mode logging

### Stigmer CLI (stigmer OSS repo)
- **NEW FILE**: `secrets.go` with secret prompting (masked input)
- Updated `daemon.go` to:
  - Gather secrets before starting services
  - Spawn agent-runner subprocess with injected environment
  - Manage two processes (stigmer-server + agent-runner)
  - Handle graceful shutdown of both
  - Find agent-runner script automatically
- Added `golang.org/x/term` dependency for password masking

## Implementation Highlights

**Zero-Config Local Development**:
```bash
$ stigmer local start
Enter Anthropic API key: ********
✓ Anthropic API key configured
Starting daemon...
Daemon started successfully
  PID:  12345
  Port: 50051
  Data: /Users/suresh/.stigmer
Agent-runner started successfully
```

**Security**:
- Secrets only in process memory (never on disk)
- Masked terminal input
- No hardcoded credentials
- Proper environment isolation

**Lifecycle Management**:
- Single command to start both processes
- Graceful shutdown with SIGTERM
- PID file tracking
- Separate log files for each service

## Files Modified/Created

**Created**:
- `client-apps/cli/internal/cli/daemon/secrets.go`
- `_projects/2026-01/20260119.01.agent-runner-local-mode/TESTING.md`
- `_projects/2026-01/20260119.01.agent-runner-local-mode/T4-IMPLEMENTATION-SUMMARY.md`

**Modified**:
- `client-apps/cli/internal/cli/daemon/daemon.go`
- `client-apps/cli/go.mod`
- `client-apps/cli/go.sum`
- `backend/services/agent-runner/worker/config.py` (T2)
- `backend/services/agent-runner/worker/worker.py` (T3)
- `backend/services/agent-runner/main.py` (T3)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (T2)

**In graphton repo** (separate):
- `src/graphton/core/backends/filesystem.py`
- `src/graphton/core/sandbox_factory.py`
- `tests/core/backends/test_filesystem_backend.py`

## Files

- `README.md` - Project overview
- `tasks.md` - All tasks with detailed requirements
- `notes.md` - Quick notes and learnings
- `next-task.md` - This file (drag into chat to resume!)

---

**To resume**: Just drag this file into any chat or reference: `@_projects/2026-01/20260119.01.agent-runner-local-mode/next-task.md`
