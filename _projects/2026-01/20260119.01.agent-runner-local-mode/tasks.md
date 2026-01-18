# Tasks

## Phase 1: Graphton Filesystem Backend Enhancement

### T1: Implement `execute()` in FilesystemBackend with subprocess support
**Status**: ✅ COMPLETED

**Objective**: Add shell command execution capability to Graphton's FilesystemBackend using Python's subprocess module.

**Location**: `graphton/core/backends/filesystem.py`

**Requirements**:
- Add `execute(command, timeout)` method
- Use `subprocess.run()` with proper error handling
- Execute in workspace directory (`cwd=self.root_dir`)
- Capture stdout/stderr
- Inject environment variables (for API keys)
- Return `ExecutionResult` with exit code, stdout, stderr

**Acceptance**:
- [x] Method executes shell commands on host machine
- [x] Commands run in correct working directory
- [x] Environment variables are properly inherited
- [x] Timeout handling works correctly
- [x] Error handling is robust

**Implementation Details**:
- Created new `graphton/core/backends/` directory with enhanced FilesystemBackend
- Implemented `execute()` method using `subprocess.run()`
- Added `ExecutionResult` dataclass for structured return values
- Maintained compatibility with deepagents interface (`read`, `write` methods)
- Updated sandbox_factory to use local FilesystemBackend
- Created comprehensive test suite with 10 test cases - all passing
- All existing Graphton tests (163) still passing

---

## Phase 2: Agent Runner Configuration

### T2: Update Agent Runner config to detect `MODE=local` and use filesystem backend
**Status**: ✅ COMPLETED

**Objective**: Add local mode detection and configuration in Agent Runner.

**Location**: `stigmer/backend/services/agent-runner/worker/config.py`

**Requirements**:
- Detect `MODE=local` environment variable (separate from ENV for dev/staging/prod)
- Return filesystem backend config when local
- Return Daytona config when cloud
- Set proper workspace paths
- Skip cloud-specific config (Auth0, Redis, etc.)

**Acceptance**:
- [x] Config switches based on `MODE` variable
- [x] Local mode uses filesystem backend
- [x] Cloud mode uses Daytona backend
- [x] No errors when cloud config is missing in local mode
- [x] MODE is separate from ENV (development/staging/production)

**Implementation Details**:
- Updated `Config` class to detect `MODE=local` environment variable
- Added `mode`, `sandbox_type`, and `sandbox_root_dir` fields to Config
- Made Redis configuration optional (None in local mode)
- Added `get_sandbox_config()` method that returns appropriate config based on mode
- Added `is_local_mode()` helper method
- Updated `execute_graphton.py` to use config-driven sandbox configuration
- In local mode, sandbox manager is bypassed and config passed directly to Graphton
- Skills temporarily disabled in local mode (will be implemented in future iteration)
- Clear separation: MODE (local/cloud) vs ENV (dev/staging/prod)

---

## Phase 3: Agent Runner Runtime

### T3: Update Agent Runner main to connect to Stigmer Daemon gRPC
**Status**: ⏸️ TODO

**Objective**: Replace cloud service connections with Stigmer Daemon gRPC in local mode.

**Location**: `stigmer/backend/services/agent-runner/worker/worker.py` and `main.py`

**Requirements**:
- Connect to `STIGMER_BACKEND_ENDPOINT` (localhost:50051) in local mode
- Connect to Redis in cloud mode
- Skip Auth0 validation in local mode
- Handle gRPC streaming for workflow events
- Proper error handling for connection failures

**Acceptance**:
- [ ] Local mode connects to Stigmer Daemon
- [ ] Cloud mode connects to Redis
- [ ] Auth checks are bypassed in local mode
- [ ] gRPC streaming works correctly
- [ ] Graceful degradation on connection errors

---

## Phase 4: Secret Management

### T4: Implement secret injection in Stigmer Daemon/CLI for API keys
**Status**: ⏸️ TODO

**Objective**: Securely prompt for and inject API keys when starting Agent Runner in local mode.

**Location**: Stigmer CLI/Daemon (`cmd/local/start.go` or similar)

**Requirements**:
- Scan for required API keys (ANTHROPIC_API_KEY, etc.)
- Prompt user with masked input if missing
- Inject keys into Agent Runner subprocess environment
- Never write keys to disk
- Support multiple LLM providers

**Acceptance**:
- [ ] CLI prompts for missing API keys
- [ ] Input is masked/hidden
- [ ] Keys are injected into subprocess environment
- [ ] Keys are never written to config files
- [ ] Works for multiple provider keys

---

## Phase 5: Testing & Validation

### T5: End-to-end testing and validation
**Status**: ⏸️ TODO

**Objective**: Verify complete local workflow execution without cloud dependencies.

**Test Scenarios**:
1. Start Agent Runner in local mode
2. Execute workflow with shell commands
3. Verify filesystem operations
4. Verify LLM API calls work
5. Verify streaming to Stigmer Daemon
6. Test error scenarios

**Acceptance**:
- [ ] Complete workflow executes locally
- [ ] Shell commands run successfully
- [ ] File operations work in workspace
- [ ] LLM calls succeed with injected keys
- [ ] Events stream to Stigmer Daemon
- [ ] Error scenarios handled gracefully

---

## Progress Summary

- **Total Tasks**: 5
- **Completed**: 2
- **In Progress**: 0
- **Remaining**: 3

**Current Status**: T2 Complete - Agent Runner config updated for local mode detection
**Next Task**: T3 - Update Agent Runner main to connect to Stigmer Daemon gRPC
