# Graphton FilesystemBackend Execute Implementation

**Date**: January 19, 2026  
**Project**: Agent Runner Local Mode (T1)  
**Type**: Feature Implementation  
**Scope**: Graphton Library Enhancement

## Summary

Implemented shell command execution capability in Graphton's FilesystemBackend to enable local agent runtime mode. This is the foundation for running Agent Runner without cloud infrastructure dependencies (Daytona, Redis, Auth0).

## What Changed

### New Files Created (Graphton Repo)

1. **`src/graphton/core/backends/__init__.py`**
   - Package initialization for backends module
   - Exports enhanced FilesystemBackend

2. **`src/graphton/core/backends/filesystem.py`** (230 lines)
   - Enhanced FilesystemBackend class with execute() method
   - ExecutionResult dataclass for structured return values
   - File operation methods (read, write, list_files)
   - Compatible interface with deepagents FilesystemBackend

3. **`tests/test_filesystem_backend.py`** (150 lines)
   - Comprehensive test suite (10 test cases)
   - Tests for command execution, timeout, error handling
   - Tests for environment variable preservation
   - Tests for workspace directory operations

### Modified Files (Graphton Repo)

1. **`src/graphton/core/sandbox_factory.py`**
   - Updated to use local FilesystemBackend instead of deepagents version
   - Updated docstrings to reflect execution capability
   - Updated example usage

### Project Documentation Updated (Stigmer Repo)

1. **`_projects/2026-01/20260119.01.agent-runner-local-mode/tasks.md`**
   - Marked T1 as completed with implementation details
   - Updated progress summary (1/5 tasks complete)

2. **`_projects/2026-01/20260119.01.agent-runner-local-mode/next-task.md`**
   - Updated current task from T1 to T2
   - Added T1 completion summary
   - Documented next steps

3. **`_projects/2026-01/20260119.01.agent-runner-local-mode/notes.md`** (New)
   - Created comprehensive implementation notes
   - Documented technical decisions
   - Test results and performance notes
   - Questions for next task

## Implementation Details

### ExecutionResult Structure

```python
@dataclass
class ExecutionResult:
    """Result of a shell command execution."""
    exit_code: int    # 0 for success, non-zero for errors
    stdout: str       # Standard output capture
    stderr: str       # Standard error capture
```

### Execute Method

```python
def execute(
    self,
    command: str,
    timeout: int = 120,
    **kwargs: Any,
) -> ExecutionResult:
    """Execute shell command on the host machine.
    
    Commands are executed in the workspace directory (self.root_dir) with
    environment variables inherited from the current process. This allows
    API keys and other secrets to be passed through the environment.
    """
```

### Key Design Decisions

1. **Error Handling Strategy**
   - Never raises exceptions - all errors captured in ExecutionResult
   - Predictable API for consumers
   - Easy error checking via exit_code

2. **Timeout Handling**
   - Default timeout: 120 seconds
   - Uses standard exit code 124 for timeouts
   - Captures partial stdout/stderr before timeout

3. **Environment Injection**
   - Inherits all parent process environment variables
   - Adds PYTHONUNBUFFERED=1 for real-time output
   - Enables secret injection from Stigmer Daemon

4. **Working Directory**
   - All commands execute in self.root_dir (workspace)
   - Provides process isolation without containerization
   - Direct host filesystem access

5. **Interface Compatibility**
   - Provides both `read()`/`write()` and `read_file()`/`write_file()`
   - Compatible with deepagents FilesystemBackend interface
   - Allows drop-in replacement

## Test Results

**New Tests (test_filesystem_backend.py)**:
```
✅ 10/10 tests passed in 3.93s
- test_execute_simple_command
- test_execute_with_exit_code
- test_execute_with_stderr
- test_execute_in_workspace_directory
- test_execute_with_timeout
- test_execute_invalid_command
- test_execute_preserves_environment
- test_file_operations
- test_workspace_directory_creation
- test_execution_result_creation
```

**Regression Tests**:
```
✅ Sandbox config tests: 23/23 passed
✅ Full Graphton test suite: 163/163 passed (29 skipped)
```

## Security Considerations

**Host Machine Execution**:
- Commands run with same permissions as parent process
- Can access entire host filesystem (not sandboxed)
- Suitable for trusted local development only
- Production deployments should use Daytona backend

**Documented in Code**:
```python
"""
Security Notes:
    - Commands run with the same permissions as the parent process
    - Commands can access the entire host filesystem
    - Use only in trusted local development environments
    - For production, use sandboxed backends like Daytona
"""
```

## Usage Example

```python
from graphton.core.backends import FilesystemBackend
from graphton.core.sandbox_factory import create_sandbox_backend

# Direct instantiation
backend = FilesystemBackend(root_dir="/workspace")
result = backend.execute("echo 'Hello World'")
assert result.exit_code == 0
assert "Hello World" in result.stdout

# Via sandbox factory (recommended)
config = {
    "type": "filesystem",
    "root_dir": "./workspace"
}
backend = create_sandbox_backend(config)
result = backend.execute("pip install requests", timeout=300)
if result.exit_code != 0:
    print(f"Installation failed: {result.stderr}")
```

## Integration with Agent Runner Local Mode

This implementation provides the execution foundation for ENV=local mode:

1. **Agent Runner Configuration** (T2 - Next)
   - Will detect ENV=local environment variable
   - Return filesystem backend config instead of Daytona
   - Skip cloud dependencies (Auth0, Redis)

2. **Stigmer Daemon Integration** (T3 - Future)
   - Daemon will start Agent Runner subprocess
   - Inject API keys via environment variables
   - Connect via gRPC for event streaming

3. **Secret Management** (T4 - Future)
   - Daemon prompts for missing API keys
   - Keys injected into subprocess environment
   - Never written to disk or config files

## Why This Approach

**Problem**: Current Agent Runner requires full cloud stack (Daytona, Redis, Auth0, S3/R2) even for local development. This violates the "Tier 1" principle (zero-config local experience).

**Solution**: Enable direct host execution for local mode while preserving cloud execution for production.

**Trade-offs**:
- ✅ Zero infrastructure setup for local development
- ✅ Instant command execution (no container overhead)
- ✅ Full tool access (whatever's installed on host)
- ✅ Simple debugging (commands run in familiar environment)
- ⚠️ No process isolation (acceptable for local dev)
- ⚠️ Host OS dependencies (tools must be installed)
- ⚠️ Not suitable for production (use Daytona there)

## Cross-Repository Impact

**Graphton Library** (github.com/plantonhq/graphton):
- Enhanced with execute() capability
- Breaking change: None (additive API)
- Version: Will be in next Graphton release

**Stigmer Agent Runner** (github.com/stigmer/stigmer or separate repo):
- Will consume enhanced Graphton in T2
- Configuration changes to detect ENV=local
- Runtime changes to skip cloud dependencies

## Next Steps (T2)

**Update Agent Runner Config**:
1. Locate Agent Runner configuration code
2. Add ENV=local detection
3. Return filesystem backend config for local mode
4. Return Daytona config for cloud mode (existing)
5. Skip cloud-specific config in local mode

**Files to Modify**:
- Agent Runner config.py or equivalent
- Potentially main.py for connection logic
- Environment variable handling

## Performance Notes

**Command Execution**:
- Synchronous blocking (subprocess.run)
- No async support yet (can be added if needed)
- Default timeout: 120s (configurable per command)

**Environment Variable Handling**:
- Lightweight copy of os.environ
- No performance impact
- Keys available immediately to subprocess

**Workspace Creation**:
- Automatically creates workspace directory
- Uses pathlib for cross-platform compatibility

## Files Modified by Implementation

**Graphton Repo** (github.com/plantonhq/graphton):
- `src/graphton/core/backends/__init__.py` (new)
- `src/graphton/core/backends/filesystem.py` (new, 230 lines)
- `src/graphton/core/sandbox_factory.py` (modified, 3 sections updated)
- `tests/test_filesystem_backend.py` (new, 150 lines)

**Stigmer Repo** (github.com/stigmer/stigmer):
- `_projects/2026-01/20260119.01.agent-runner-local-mode/tasks.md` (updated)
- `_projects/2026-01/20260119.01.agent-runner-local-mode/next-task.md` (updated)
- `_projects/2026-01/20260119.01.agent-runner-local-mode/notes.md` (new, comprehensive notes)

## Lessons Learned

1. **Interface Compatibility Matters**
   - Maintaining compatibility with deepagents interface prevented breaking changes
   - Both `read()`/`write()` and `read_file()`/`write_file()` needed for smooth transition

2. **Error Handling Philosophy**
   - Returning errors in ExecutionResult instead of exceptions makes API more predictable
   - Easier for callers to handle error cases uniformly

3. **Test Coverage Validates Design**
   - Comprehensive tests caught timeout handling edge cases early
   - Environment variable preservation test validated secret injection design

4. **Security Documentation is Critical**
   - Clear security warnings in docstrings help users understand risks
   - Important for open-source library where usage patterns vary

## References

- **ADR**: See `_cursor/adr-doc` (ADR 016: Local Agent Runner Runtime Strategy)
- **Project**: `_projects/2026-01/20260119.01.agent-runner-local-mode/`
- **Graphton Repo**: https://github.com/plantonhq/graphton

---

**Status**: T1 Complete ✅  
**Next**: T2 - Update Agent Runner config for local mode detection  
**Branch**: main (Graphton changes need to be committed and potentially released)
