# Implementation Notes

## T1: FilesystemBackend Execute Implementation

**Date**: January 19, 2026  
**Status**: ✅ Completed

### What Was Built

Created an enhanced FilesystemBackend in Graphton that supports shell command execution for local agent runtime.

#### Files Created

1. **`/Users/suresh/scm/github.com/plantonhq/graphton/src/graphton/core/backends/__init__.py`**
   - Package initialization
   - Exports FilesystemBackend

2. **`/Users/suresh/scm/github.com/plantonhq/graphton/src/graphton/core/backends/filesystem.py`**
   - Enhanced FilesystemBackend class
   - `execute()` method using subprocess
   - ExecutionResult dataclass
   - File operation methods (read, write, list_files)
   - Compatible with deepagents interface

3. **`/Users/suresh/scm/github.com/plantonhq/graphton/tests/test_filesystem_backend.py`**
   - Comprehensive test suite (10 tests)
   - Tests execution, timeout, error handling, environment preservation

#### Files Modified

1. **`/Users/suresh/scm/github.com/plantonhq/graphton/src/graphton/core/sandbox_factory.py`**
   - Updated to use local FilesystemBackend instead of deepagents version
   - Updated docstrings to reflect execution capability
   - Updated example usage

### Technical Details

#### ExecutionResult Structure

```python
@dataclass
class ExecutionResult:
    exit_code: int    # 0 for success, non-zero for errors
    stdout: str       # Standard output capture
    stderr: str       # Standard error capture
```

#### Execute Method Signature

```python
def execute(
    self,
    command: str,
    timeout: int = 120,
    **kwargs: Any,
) -> ExecutionResult:
```

#### Key Implementation Decisions

1. **Error Handling**: All errors captured in ExecutionResult, never raises exceptions
2. **Timeout Exit Code**: Uses 124 (standard timeout exit code)
3. **Environment Injection**: Inherits all environment variables + PYTHONUNBUFFERED=1
4. **Working Directory**: All commands execute in self.root_dir
5. **Compatibility**: Added both `read`/`write` and `read_file`/`write_file` methods

### Test Results

```bash
# New tests
poetry run pytest tests/test_filesystem_backend.py -v
# Result: 10 passed in 3.93s

# Existing tests (regression check)
poetry run pytest tests/test_sandbox_config.py -v
# Result: 23 passed

# Full test suite
poetry run pytest tests/ -v
# Result: 163 passed, 29 skipped
```

### Security Considerations

From the implementation:
```python
"""
Security Notes:
    - Commands run with the same permissions as the parent process
    - Commands can access the entire host filesystem
    - Use only in trusted local development environments
    - For production, use sandboxed backends like Daytona
"""
```

### Usage Example

```python
from graphton.core.backends import FilesystemBackend

# Create backend
backend = FilesystemBackend(root_dir="/workspace")

# Execute commands
result = backend.execute("echo 'Hello World'")
assert result.exit_code == 0
assert "Hello World" in result.stdout

# File operations
backend.write("test.txt", "content")
content = backend.read("test.txt")
```

### Integration with Sandbox Factory

```python
# Local mode configuration
config = {
    "type": "filesystem",
    "root_dir": "./workspace"
}

backend = create_sandbox_backend(config)
# Returns: FilesystemBackend with execute() capability
```

### Next Steps (For T2)

1. Locate Agent Runner configuration code
   - Likely in stigmer-cloud or separate agent-runner repo
   - Look for config.py or similar files
   
2. Add ENV detection logic
   ```python
   if os.getenv("ENV") == "local":
       return {"type": "filesystem", "root_dir": "./workspace"}
   else:
       return daytona_config  # existing cloud config
   ```

3. Skip cloud dependencies in local mode
   - No Auth0 validation
   - No Redis connection
   - Connect to Stigmer Daemon instead

### Questions for Next Task

- Where is the Agent Runner code located?
- Is it in stigmer-cloud backend or separate repo?
- What's the current config structure?

### Performance Notes

- Command execution is synchronous (subprocess.run blocks)
- Timeout default: 120 seconds
- No sandboxing - direct host execution
- Environment variable inheritance is lightweight (copy of os.environ)

### Lessons Learned

1. **Interface Compatibility**: Important to maintain backward compatibility with deepagents interface
2. **Test Coverage**: Comprehensive tests caught timeout handling edge cases
3. **Error Handling**: Returning errors in ExecutionResult instead of raising exceptions makes the API more predictable
4. **Documentation**: Extensive docstrings help future developers understand security implications

---

## T2: Agent Runner Local Mode Configuration

**Date**: January 19, 2026  
**Status**: ✅ Completed

### What Was Built

Updated Agent Runner configuration to support local execution mode (`MODE=local`) with automatic sandbox backend selection.

**Important**: Using `MODE` (not `ENV`) to avoid confusion:
- `MODE` determines execution infrastructure (local filesystem vs cloud sandbox)
- `ENV` determines deployment environment (development/staging/production)

#### Files Modified

1. **`stigmer/backend/services/agent-runner/worker/config.py`** (OSS repo)
   - Added `mode` field to detect execution mode (local vs cloud)
   - Added `sandbox_type` and `sandbox_root_dir` fields
   - Made Redis configuration optional (None in local mode)
   - Created `get_sandbox_config()` method for dynamic config generation
   - Added `is_local_mode()` helper method
   - Enhanced docstrings with mode-specific behavior
   - Clearly documented MODE vs ENV distinction

2. **`stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py`** (OSS repo)
   - Updated to use `Config.get_sandbox_config()` instead of hardcoded Daytona config
   - Added mode detection and conditional sandbox manager initialization
   - Bypasses SandboxManager in local mode
   - Disabled skills in local mode (temporary - future enhancement)
   - Updated logging to show current execution mode

### Technical Details

#### Config Class Changes

**New Fields**:
```python
mode: str  # "local" or "cloud" (separate from ENV!)
sandbox_type: str  # "filesystem" for local, "daytona" for cloud
sandbox_root_dir: str | None  # Required for filesystem backend
redis_host: str | None  # None in local mode
redis_port: int | None  # None in local mode
redis_password: str | None  # Optional in both modes
```

**New Methods**:
```python
def get_sandbox_config(self) -> dict:
    """Returns appropriate sandbox config based on mode."""
    # Local: {"type": "filesystem", "root_dir": "./workspace"}
    # Cloud: {"type": "daytona", "snapshot_id": "..."}

def is_local_mode(self) -> bool:
    """Check if running in local execution mode."""
    return self.mode == "local"
```

#### Environment Variable Specification

**Local Mode Variables**:
```bash
MODE="local"  # Execution mode (not ENV!)
SANDBOX_TYPE="filesystem"  # Default
SANDBOX_ROOT_DIR="./workspace"  # Default
STIGMER_BACKEND_ENDPOINT="localhost:50051"  # Daemon gRPC
STIGMER_API_KEY="dummy-local-key"  # Relaxed validation

# Not required in local mode:
# REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
# DAYTONA_API_KEY

# ENV can still be set separately for deployment environment:
# ENV="development"  # or "staging", "production"
```

**Cloud Mode Variables** (existing behavior):
```bash
MODE="cloud"  # or unset (defaults to cloud)
REDIS_HOST="..."
REDIS_PORT="6379"
DAYTONA_API_KEY="..."
STIGMER_API_KEY="..."
STIGMER_BACKEND_ENDPOINT="..."

# ENV for deployment environment:
# ENV="production"  # or "development", "staging"
```

#### Execution Flow Changes

**Before (Cloud Only)**:
```
1. Load config
2. Hardcode Daytona sandbox config
3. Create SandboxManager with Daytona API key
4. Get/create Daytona sandbox
5. Pass sandbox_id to Graphton
```

**After (Mode-Aware)**:
```
1. Load config (detects ENV=local or ENV=cloud)
2. Get sandbox config via config.get_sandbox_config()
3. If local mode:
   - Skip SandboxManager
   - Pass filesystem config directly to Graphton
4. If cloud mode:
   - Create SandboxManager
   - Get/create Daytona sandbox
   - Pass sandbox_id to Graphton
```

### Key Implementation Decisions

1. **Backward Compatibility**: Cloud mode behavior unchanged, all existing tests pass
2. **API Key Relaxation**: Local mode accepts "dummy-local-key" for development
3. **Skills Disabled**: Skills require sandbox file upload, temporarily disabled in local mode
4. **Config Defaults**: Sensible defaults for local mode (./workspace, localhost:50051)
5. **Redis Optional**: Redis fields can be None, no validation errors in local mode

### Configuration Testing

#### Local Mode Example

```python
# Set environment
os.environ["MODE"] = "local"  # Execution mode
os.environ["ENV"] = "development"  # Deployment environment (optional)
os.environ["SANDBOX_TYPE"] = "filesystem"
os.environ["SANDBOX_ROOT_DIR"] = "./workspace"

# Load config
config = Config.load_from_env()

# Verify
assert config.mode == "local"
assert config.is_local_mode() == True
assert config.sandbox_type == "filesystem"
assert config.redis_host is None

# Get sandbox config
sandbox_config = config.get_sandbox_config()
assert sandbox_config == {
    "type": "filesystem",
    "root_dir": "./workspace"
}
```

#### Cloud Mode Example

```python
# Set environment
os.environ["MODE"] = "cloud"  # Execution mode
os.environ["ENV"] = "production"  # Deployment environment (optional)
os.environ["DAYTONA_API_KEY"] = "..."
os.environ["REDIS_HOST"] = "redis.example.com"

# Load config
config = Config.load_from_env()

# Verify
assert config.mode == "cloud"
assert config.is_local_mode() == False
assert config.sandbox_type == "daytona"
assert config.redis_host == "redis.example.com"

# Get sandbox config
sandbox_config = config.get_sandbox_config()
assert sandbox_config["type"] == "daytona"
```

### Integration Points

**execute_graphton.py Changes**:
```python
# Import config
from worker.config import Config
worker_config = Config.load_from_env()
sandbox_config = worker_config.get_sandbox_config()

# Log mode (local or cloud)
activity_logger.info(f"Sandbox mode: {worker_config.mode}")

# Mode-aware sandbox handling
if worker_config.is_local_mode():
    # Local mode - bypass SandboxManager
    sandbox_config_for_agent = sandbox_config.copy()
else:
    # Cloud mode - use SandboxManager
    sandbox_manager = SandboxManager(daytona_api_key)
    sandbox, is_new = await sandbox_manager.get_or_create_sandbox(...)
    sandbox_config_for_agent = {
        "type": "daytona",
        "sandbox_id": sandbox.id
    }

# Pass to Graphton (works for both modes)
agent_graph = create_deep_agent(
    sandbox_config=sandbox_config_for_agent,
    ...
)
```

### Temporary Limitations

1. **Skills Not Supported in Local Mode**
   - Requires filesystem upload mechanism
   - Will be implemented in future iteration
   - Currently shows warning if skills configured

2. **Sandbox Persistence**
   - Local mode doesn't persist sandbox between runs
   - Each execution starts with fresh workspace
   - Future: Could implement workspace caching

### Security Considerations

**Local Mode**:
- API key validation relaxed (accepts dummy keys)
- No Auth0 token validation
- Commands run on host with user's permissions
- Suitable for trusted local development only

**Cloud Mode**:
- Full API key validation required
- Auth0 token validation (existing behavior)
- Commands run in isolated Daytona sandbox
- Production-ready security

### Testing Strategy

Since this is configuration-only changes, testing focuses on:
1. Mode detection based on ENV variable
2. Correct sandbox config generation
3. Optional fields (Redis) don't cause validation errors
4. Backward compatibility with existing cloud deployments

### Lessons Learned

1. **Gradual Migration**: Keeping cloud mode unchanged allows incremental testing
2. **Defaults Matter**: Sensible defaults make local development frictionless
3. **Optional Fields**: Making fields optional (None) instead of removing them maintains type safety
4. **Helper Methods**: `is_local_mode()` makes code more readable than checking `mode == "local"`
5. **Documentation**: Extensive docstrings crucial for mode-switching logic
6. **Naming Matters**: Using `MODE` instead of `ENV` avoids confusion with deployment environments
7. **Repository Location**: Changes made in stigmer OSS repo, not stigmer-cloud (production)

### Next Steps (For T3)

1. Update worker initialization to skip Redis when `MODE=local`
2. Connect to Stigmer Daemon gRPC (localhost:50051) in local mode
3. Handle gRPC streaming for workflow events
4. Skip Auth0 validation when `MODE=local`
5. Proper error handling for connection failures

**Remember**: Use `MODE` environment variable, not `ENV`!

---

## T2.1: Skills Support in Local Mode

**Date**: January 19, 2026  
**Status**: ✅ Completed

### What Was Built

Enabled skills support in local mode by enhancing SkillWriter to support both Daytona and filesystem backends. Previously, skills were only supported in cloud mode with Daytona sandboxes.

#### Problem Identified

Skills were explicitly disabled in local mode:
```python
# OLD CODE
if skill_refs and not worker_config.is_local_mode():
    # Skills only supported in cloud mode
    ...
elif skill_refs and worker_config.is_local_mode():
    activity_logger.warning(
        f"Skills not yet supported in local mode - skipping {len(skill_refs)} skill(s)"
    )
```

This limitation prevented local development and testing of agents with skills.

#### Files Modified

1. **`stigmer/backend/services/agent-runner/worker/activities/graphton/skill_writer.py`**
   - Added `mode` parameter to `__init__()` ("daytona" or "filesystem")
   - Split `write_skills()` into mode-specific implementations:
     - `_write_skills_daytona()` - Uses Daytona SDK's `fs.upload_files()` API
     - `_write_skills_filesystem()` - Uses Python's standard file operations
   - Added `_build_skill_content()` helper method (shared by both modes)
   - Added imports: `os`, `pathlib.Path`
   - Enhanced error handling for both modes

2. **`stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py`**
   - Removed local mode restriction for skills (lines 226-271)
   - Added mode-aware SkillWriter initialization
   - Updated logging messages to reflect mode ("wrote" vs "uploaded")
   - Simplified error handling (same path for both modes)

#### Technical Details

**SkillWriter Constructor Changes**:
```python
def __init__(self, sandbox=None, root_dir=None, mode="daytona"):
    """Initialize SkillWriter.
    
    Args:
        sandbox: Daytona Sandbox instance (required for Daytona mode)
        root_dir: Filesystem root directory (required for filesystem mode)
        mode: "daytona" or "filesystem"
    """
    self.mode = mode
    self.sandbox = sandbox
    self.root_dir = root_dir
    
    if mode == "daytona":
        if not sandbox:
            raise ValueError("sandbox is required for Daytona mode")
        self.skills_dir = self.SKILLS_DIR  # /workspace/skills
    elif mode == "filesystem":
        if not root_dir:
            raise ValueError("root_dir is required for filesystem mode")
        self.skills_dir = os.path.join(root_dir, "skills")
    else:
        raise ValueError(f"Invalid mode: {mode}")
```

**Filesystem Implementation**:
```python
def _write_skills_filesystem(self, skills: list[Skill]) -> dict[str, str]:
    """Write skills to local filesystem."""
    # Create skills directory
    Path(self.skills_dir).mkdir(parents=True, exist_ok=True)
    
    skill_paths = {}
    for skill in skills:
        skill_id = skill.metadata.id
        skill_name = skill.metadata.name
        description = skill.spec.description
        content = skill.spec.markdown_content
        
        # Build file content with metadata header
        file_content = self._build_skill_content(skill_name, description, content)
        
        # Write to filesystem
        filename = f"{skill_name}.md"
        filepath = os.path.join(self.skills_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(file_content)
        
        skill_paths[skill_id] = filepath
    
    return skill_paths
```

**Usage in execute_graphton.py**:
```python
if skill_refs:
    # Fetch skills via gRPC
    skills = await skill_client.list_by_refs(list(skill_refs))
    
    # Write skills based on mode
    if worker_config.is_local_mode():
        # Local mode - write to filesystem
        skill_writer = SkillWriter(
            root_dir=sandbox_config.get('root_dir'),
            mode="filesystem"
        )
    else:
        # Cloud mode - upload to Daytona sandbox
        skill_writer = SkillWriter(sandbox=sandbox, mode="daytona")
    
    skill_paths = skill_writer.write_skills(skills)
    
    # Generate prompt section (same for both modes)
    skills_prompt_section = SkillWriter.generate_prompt_section(skills, skill_paths)
```

#### Behavior

**Local Mode (MODE=local)**:
- Skills written to: `{SANDBOX_ROOT_DIR}/skills/*.md`
- Example: `./workspace/skills/aws-troubleshooting.md`
- File operations use Python's standard library (`open()`, `Path.mkdir()`)
- Agent reads skills using filesystem paths

**Cloud Mode (MODE=cloud)**:
- Skills uploaded to: `/workspace/skills/*.md` (in Daytona sandbox)
- Uses Daytona SDK: `sandbox.fs.upload_files()`
- Agent reads skills using sandbox paths

#### File Structure

**Skills Directory**:
```
<root_dir>/skills/
  ├── aws-troubleshooting.md
  ├── kubernetes-debugging.md
  └── terraform-best-practices.md
```

**Skill File Format** (same for both modes):
```markdown
# Skill Name

**Description**: Skill description text

---

[Markdown content from skill.spec.markdown_content]
```

#### Other Functionalities Reviewed

Analyzed entire `execute_graphton.py` to identify any other mode-specific gaps:

**✅ Fully Supported in Both Modes**:
1. Environments - merging, runtime overrides, no mode checks
2. Sandbox management - mode-aware, fully functional
3. Graphton agent creation - works with both backends
4. Execution streaming - identical in both modes

**⏳ Not Yet Implemented** (not mode-specific):
1. MCP servers - `mcp_servers={}` (line 354)
2. Sub-agents - `subagents=None` (line 356)

**Conclusion**: Skills were the **only** functionality being skipped specifically in local mode. Now fully enabled.

#### Testing Strategy

**Manual Testing**:
1. Local mode: Set `MODE=local`, create agent with skills, verify files written to `./workspace/skills/`
2. Cloud mode: Set `MODE=cloud`, create agent with skills, verify uploaded to Daytona
3. Verify agent can read skills using `read_file` tool in both modes

**Integration Testing**:
- Agent executions with skills should work identically in both modes
- Skills should be accessible via `read_file` tool
- Prompt section should include skill metadata

#### Key Implementation Decisions

1. **Mode Parameter**: Explicit mode parameter makes code clear and maintainable
2. **Separate Methods**: `_write_skills_daytona()` and `_write_skills_filesystem()` keep logic isolated
3. **Shared Helper**: `_build_skill_content()` ensures consistent file format
4. **Error Handling**: Same error types (RuntimeError) for both modes
5. **Logging**: Mode-specific messages ("wrote" vs "uploaded") for clarity
6. **No Breaking Changes**: Cloud mode behavior unchanged, backward compatible

#### Lessons Learned

1. **Premature Restrictions**: Skills could have worked in local mode from the start with proper abstraction
2. **Mode Patterns**: Establishing mode-aware patterns early (like in T2) made this change straightforward
3. **Interface Abstraction**: SkillWriter's interface (write_skills) didn't change, only implementation
4. **Testing Gaps**: Manual testing needed since no existing skill tests
5. **Documentation**: Clear mode documentation in docstrings prevents future confusion

#### Security Considerations

**Local Mode**:
- Skills written to host filesystem with user's permissions
- Skills persisted between runs (not ephemeral)
- Skills visible in workspace directory

**Cloud Mode**:
- Skills uploaded to isolated Daytona sandbox
- Skills ephemeral (unless sandbox persisted)
- Skills not accessible outside sandbox

#### Related Documentation

Created comprehensive summary: `SKILLS_LOCAL_MODE_IMPLEMENTATION.md`
- Problem statement
- Solution architecture
- Behavior comparison
- Testing guidance
- Complete functionality review

---

## Next: T3 - Agent Runner Daemon Connection

**Goal**: Update Agent Runner main to connect to Stigmer Daemon gRPC when `MODE=local`

**Steps**:
1. Update worker initialization to check `MODE`
2. Skip Redis connection when `MODE=local`
3. Connect to Stigmer Daemon gRPC in local mode
4. Handle streaming
5. Test mode switching

**Key**: Use `MODE` env var, not `ENV` (which is for dev/staging/prod)
