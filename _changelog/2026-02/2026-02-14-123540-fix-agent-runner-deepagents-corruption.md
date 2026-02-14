# Fix Agent-Runner Startup Failure from Corrupted deepagents 0.4.1

**Date**: February 14, 2026

## Summary

Resolved a critical startup failure in the agent-runner service caused by a corrupted `deepagents==0.4.1` package from PyPI. The package contained a malformed `__init__.py` with duplicate `__all__` assignments causing an `IndentationError` at line 8, preventing the service from starting. The fix excludes the broken version while preserving compatibility with future releases.

## Problem Statement

The agent-runner service was in a crash-loop, unable to complete startup. Investigation revealed an `IndentationError` during Python import of the `deepagents` package, specifically in its `__init__.py` file at line 8.

### Pain Points

- **Service unavailable**: Agent-runner container continuously restarting, preventing any agent execution
- **Import chain failure**: The error occurred deep in the dependency chain: `main.py` → `worker.register_activities()` → `execute_graphton.py` → `graphton.__init__` → `graphton.core.agent` → `deepagents.__init__` (CRASH)
- **Upstream packaging defect**: The `deepagents==0.4.1` wheel on PyPI contained a corrupted `__init__.py` file with duplicate `__all__` declarations and missing variable names
- **Silent failure mode**: The Python import system provided minimal diagnostic information beyond "unexpected indent", requiring direct inspection of the installed package

## Solution

Implemented a surgical dependency exclusion strategy that:
1. Excluded the broken `0.4.1` release using Poetry's version constraint syntax
2. Downgraded to the last known-good version `0.4.0`
3. Preserved forward compatibility with future patch releases (e.g., `0.4.2`)
4. Maintained backward compatibility with all graphton API usage

### The Corrupted Package

Inspection of the installed `deepagents==0.4.1` package revealed:

```python
# deepagents/__init__.py (line 1-8)
"""DeepAgents package."""

from deepagents.graph import create_deep_agent
from deepagents.middleware.filesystem import FilesystemMiddleware
from deepagents.middleware.subagents import CompiledSubAgent, SubAgent, SubAgentMiddleware

__all__ = ["CompiledSubAgent", "FilesystemMiddleware", "SubAgent", "SubAgentMiddleware", "create_deep_agent"]
 = [           # <--- Line 8: IndentationError - orphaned assignment
    "CompiledSubAgent",
    "FilesystemMiddleware",
    "MemoryMiddleware",
    ...
]
```

The `__all__` list appears twice: first as a complete single-line assignment, then again as a malformed multi-line list missing its variable name. Python's parser immediately fails at line 8 with "unexpected indent".

### Verification of deepagents 0.4.0

Downloaded and inspected `deepagents==0.4.0` from PyPI, confirming:
- Clean, well-formed `__init__.py` with single `__all__` declaration
- Identical API surface: `create_deep_agent`, `BackendProtocol` (all imports used by graphton)
- Compatible with `deepagents-cli==0.0.3` constraint (`>=0.4.0,<0.5.0`)

## Implementation Details

### Single-Line Change

**File**: `backend/libs/python/graphton/pyproject.toml`

**Before**:
```toml
deepagents = ">=0.4.0,<0.5.0"
```

**After**:
```toml
deepagents = ">=0.4.0,!=0.4.1,<0.5.0"  # 0.4.1 has corrupted __init__.py (IndentationError)
```

### Rationale for `!=0.4.1` (not `==0.4.0`)

Using an exclusion constraint instead of pinning to `0.4.0` provides:
1. **Self-documenting**: The inline comment explains *why* we're excluding a version
2. **Forward compatibility**: Automatically picks up `0.4.2` if/when the upstream maintainers publish a fix
3. **Flexibility**: Allows Poetry to resolve transitive dependencies more freely
4. **Maintainability**: No need to update the constraint when `0.4.2` is released

### Lock File Regeneration

Updated both Poetry lock files to resolve to `deepagents==0.4.0`:
- `backend/libs/python/graphton/poetry.lock`
- `backend/services/agent-runner/poetry.lock`

Command: `poetry lock` (Poetry 2.1.2 no longer supports `--no-update` flag)

### Docker Image Rebuild

Rebuilt the agent-runner Docker image to install the corrected dependency set:

```bash
make build-agent-runner-image
```

The multi-stage Dockerfile:
1. Base layer: Python 3.11-slim with system dependencies
2. Builder stage: Poetry install with in-project virtualenv
3. Runtime image: Copy virtualenv, install Node.js 20 for MCP servers, run as non-root user

Build output confirmed: `Installing deepagents (0.4.0)`

### Container Restart

Replaced the crash-looping container with the fixed image:

```bash
docker rm -f stigmer-agent-runner
cd backend/services/agent-runner && docker compose up -d
```

Verified clean startup with no errors or restarts.

## Benefits

### Immediate

- **Service restored**: Agent-runner now starts cleanly and polls for tasks
- **Zero downtime**: Container replacement took < 5 seconds
- **No API changes**: Graphton code remains unchanged; purely a dependency constraint update

### Logs (Before vs After)

**Before** (crash loop):
```
2026-02-14 05:53:37,446 - __main__ - ERROR - STARTUP FAILURE: Activity Registration Error
2026-02-14 05:53:37,446 - __main__ - ERROR - Error: unexpected indent (__init__.py, line 8)
2026-02-14 05:53:37,446 - __main__ - INFO - Worker process exiting
```

**After** (healthy):
```
2026-02-14 06:04:57,692 - __main__ - INFO - ✅ Activities registered successfully
2026-02-14 06:04:57,692 - __main__ - INFO - ✓ Signal handlers registered (SIGTERM, SIGINT)
2026-02-14 06:04:57,693 - __main__ - INFO - 🚀 Worker ready, polling for tasks...
2026-02-14 06:04:57,693 - worker.worker - INFO - Starting Temporal worker on task queue: agent_execution_runner
```

Container status: `Up 14 seconds (healthy)`

### Long-term

- **Resilience**: Future `0.4.2` or `0.4.3` releases will be picked up automatically if compatible
- **Documentation**: The inline comment and this changelog preserve context for future maintainers
- **Pattern**: Establishes precedent for handling corrupted upstream packages

## Impact

### Who/What is Affected

- **Agent-runner service**: Now operational after being completely unavailable
- **All agent executions**: Temporal activities (`ExecuteGraphton`, `EnsureThread`, `CleanupSandbox`) are now available
- **CLI workflows**: Users can execute agents via `stigmer agent execute` without service failures
- **Development velocity**: Unblocks all agent-related development and testing

### Scope

- **No changes**: Graphton application code, agent-runner Python code, Dockerfile, docker-compose
- **Changed files**: 3 total
  - `backend/libs/python/graphton/pyproject.toml` (1 line)
  - `backend/libs/python/graphton/poetry.lock` (regenerated)
  - `backend/services/agent-runner/poetry.lock` (regenerated)

## Related Work

### Dependencies

This fix builds on commit `bf094460` (Feb 13, 2026), which upgraded `deepagents` from `0.2.4` to `0.4.1` to fix recursion limit errors. That commit inadvertently introduced the corrupted dependency.

### Prior Art

Commit `e864bfdc` (Feb 13, 2026) renamed Graphton's `SummarizationMiddleware` to `ContextSummarizationMiddleware` to avoid a name collision with DeepAgents' auto-injected middleware. This demonstrates ongoing integration work with the `deepagents` library.

### Upstream Issue

The packaging defect in `deepagents==0.4.1` should be reported to the upstream maintainers at https://github.com/langchain-ai/deepagents/issues. The PyPI release may need to be yanked to prevent others from encountering this failure.

## Testing

- ✅ Poetry lock files resolve to `deepagents==0.4.0`
- ✅ Docker image build completes successfully
- ✅ Container starts and reaches healthy state
- ✅ Activity registration completes without errors
- ✅ Temporal worker polling for tasks on queue `agent_execution_runner`
- ✅ No import errors or IndentationError in logs
- ✅ Container status: `Up` and `(healthy)` - no restart loop

---

**Status**: ✅ Production Ready  
**Timeline**: Diagnosed and fixed in ~1 hour  
**Committed**: e4a7e0d1 (included in larger type-checking improvement commit)
