# Fix Agent-Runner Crash Loop: deepagents-cli Namespace Collision

**Date**: February 14, 2026

## Summary

Resolved a critical agent-runner crash loop caused by a packaging defect in `deepagents-cli==0.0.3` that overwrites files from the `deepagents` package during installation. This was the actual root cause of both corruption incidents today (not the PyPI packages themselves). Implemented a three-part defense: force-reinstall workaround, build-time verification gate, and enhanced runtime healthcheck. Agent-runner is now operational with protections against future corruption.

## Problem Statement

The agent-runner service was in a continuous crash loop, restarting every ~6 seconds and failing with a Python SyntaxError during module import:

```
SyntaxError: invalid syntax (subagents.py, line 482)
    re(AgentMiddleware):
                       ^
```

This was the **second** corruption incident today with the `deepagents` package family. The first incident (documented in earlier changelog) blamed `deepagents==0.4.1` and excluded it via version constraint. However, the crash loop persisted even after excluding `0.4.1` and downgrading to `0.4.0`.

### Pain Points

- **Service unavailable**: Agent-runner continuously restarting, preventing all agent execution workflows
- **Misdiagnosed root cause**: Initial fix targeted `deepagents==0.4.1` as corrupted, but the real culprit was elsewhere
- **Silent corruption**: The corruption occurred during package installation, not from PyPI, requiring deep investigation
- **No runtime protection**: Corrupted packages could make it into production containers without detection

## Solution

### Discovery: The Real Root Cause

Through diagnostic investigation, we discovered:

1. **PyPI packages are clean**: Fresh download of `deepagents==0.4.0` from PyPI shows correct `class SubAgentMiddleware(AgentMiddleware):` at line 482
2. **Corruption during installation**: Poetry build logs show `deepagents-cli` overwriting files:
   ```
   Installing deepagents (0.4.0)
   Installing deepagents-cli (0.0.3)
   Installing .../deepagents/__init__.py over existing file
   Installing .../deepagents/middleware/subagents.py over existing file
   ```
3. **Namespace collision**: Both `deepagents` and `deepagents-cli` packages ship files in the same `deepagents/` directory, but `deepagents-cli`'s copies are truncated/corrupted

This is an **upstream packaging defect** in `deepagents-cli==0.0.3` -- it should not be shipping files that belong to the `deepagents` package namespace.

### Implementation: Three-Layer Defense

We cannot remove `deepagents-cli` because it's actively used (`graphton/core/backends/daytona.py` imports `deepagents_cli.integrations.daytona.DaytonaBackend`). Instead, we implemented three complementary defenses:

#### 1. Force-Reinstall Workaround (Dockerfile)

Added to the builder stage after `poetry install`:

```dockerfile
# WORKAROUND: deepagents-cli (0.0.3) ships files in the `deepagents/` namespace that
# overwrite clean files from the `deepagents` package during installation. This is an
# upstream packaging defect -- both packages write to the same directory, and the CLI
# package's copies are corrupted/truncated. Reinstalling `deepagents` after Poetry
# restores the correct files. The verification step below will catch any regression.
RUN .venv/bin/pip install --force-reinstall --no-deps deepagents==0.4.0
```

This restores the clean files after Poetry's sequential installation corrupts them.

#### 2. Build-Time Verification Gate (Dockerfile)

Added immediately after the reinstall:

```dockerfile
# Verify critical dependencies are importable (catches corrupted PyPI packages at build time).
# This gate prevents a broken image from ever being tagged.
RUN .venv/bin/python -c "\
from deepagents.middleware.subagents import SubAgentMiddleware; \
from deepagents.middleware.filesystem import FilesystemMiddleware; \
from deepagents import create_deep_agent; \
print('deepagents import verification passed')"
```

If any package is corrupted, `docker build` fails immediately with a clear error, preventing a broken image from being tagged or deployed.

#### 3. Enhanced Runtime Healthcheck (Dockerfile)

Updated the container healthcheck to include `deepagents` imports:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD /app/.venv/bin/python -c "from worker.config import Config; from deepagents.middleware.subagents import SubAgentMiddleware" || exit 1
```

This catches corrupted installations at container startup, causing the container to report unhealthy instead of crash-looping silently.

#### 4. Dependency Constraint Hardening (pyproject.toml)

Tightened the `deepagents-cli` version constraint:

```toml
# Before:
deepagents-cli = "*"

# After:
deepagents-cli = ">=0.0.3,<0.1.0"  # pinned: wildcard pulled corrupted transitive deps twice (2026-02-14)
```

The wildcard (`*`) was too permissive and allowed Poetry's resolver to make suboptimal choices. Pinning to a specific range prevents future surprises.

## Implementation Details

### Files Modified

1. **`backend/services/agent-runner/Dockerfile`** (lines 52-65, 119-126)
   - Added force-reinstall workaround after Poetry install
   - Added build-time import verification gate
   - Enhanced HEALTHCHECK to test deepagents imports

2. **`backend/services/agent-runner/pyproject.toml`** (line 38)
   - Tightened `deepagents-cli` from `"*"` to `">=0.0.3,<0.1.0"`

3. **`backend/services/agent-runner/poetry.lock`**
   - Regenerated to match updated constraint (still resolves to `deepagents==0.4.0`)

### Build and Deployment

**Image rebuild**:
```bash
make build-agent-runner-image
```

Build output confirmed:
```
#18 [builder 7/8] RUN .venv/bin/pip install --force-reinstall --no-deps deepagents==0.4.0
#18 0.919 Successfully installed deepagents-0.4.0

#20 [builder 8/8] RUN .venv/bin/python -c ...
#20 1.806 deepagents import verification passed
```

Both Docker tags updated:
- `stigmer-agent-runner:local` → `d71a236df98f` (new fixed image)
- `ghcr.io/stigmer/agent-runner:latest` → `d71a236df98f` (new fixed image)

**Container restart**:
```bash
docker rm -f stigmer-agent-runner
cd backend/services/agent-runner && docker compose up -d
```

Container status after 10 seconds: `Up 10 seconds (healthy)`

### Verification Logs

Clean startup confirmed:

```
2026-02-14 12:15:26,579 - __main__ - INFO - ✅ Activities registered successfully
2026-02-14 12:15:26,580 - __main__ - INFO - ✓ Signal handlers registered (SIGTERM, SIGINT)
2026-02-14 12:15:26,580 - __main__ - INFO - 🚀 Worker ready, polling for tasks...
2026-02-14 12:15:26,580 - worker.worker - INFO - Starting Temporal worker on task queue: agent_execution_runner
```

No import errors, no SyntaxError, no crash loop.

## Benefits

### Immediate

- **Service restored**: Agent-runner now starts cleanly and processes Temporal activities
- **Root cause identified**: We now understand the real issue (namespace collision, not corrupted PyPI packages)
- **Defense in depth**: Three-layer protection prevents recurrence
- **Faster detection**: Build-time verification catches corruption before deployment

### Long-term

- **Pattern for similar issues**: The force-reinstall workaround can be applied to other namespace collisions
- **Build confidence**: Build-time verification gates prevent shipping broken images
- **Healthcheck improvements**: Runtime healthcheck now tests critical external dependencies
- **Upstream awareness**: Documented defect can be reported to `deepagents` maintainers

### Logs: Before vs After

**Before** (crash loop):
```
2026-02-14 12:01:25,157 - __main__ - ERROR - ❌ Fatal error in worker: invalid syntax (subagents.py, line 482)
2026-02-14 12:01:25,157 - __main__ - ERROR - STARTUP FAILURE: Activity Registration Error
2026-02-14 12:01:25,157 - __main__ - INFO - Worker process exiting
```
Repeated every ~6 seconds indefinitely.

**After** (healthy):
```
2026-02-14 12:15:26,579 - __main__ - INFO - ✅ Activities registered successfully
2026-02-14 12:15:26,580 - __main__ - INFO - 🚀 Worker ready, polling for tasks...
```
Container status: `Up (healthy)`, no restarts.

## Impact

### Who/What is Affected

- **Agent-runner service**: Fully operational after being completely unavailable
- **All agent executions**: Temporal activities (`ExecuteGraphton`, `EnsureThread`, `CleanupSandbox`) now work
- **CLI workflows**: Users can execute agents via `stigmer agent execute` without service failures
- **Development velocity**: Unblocks all agent-related development and testing
- **CI/CD**: Docker images now have build-time validation preventing broken releases

### Scope

- **Changed files**: 3 total
  - `backend/services/agent-runner/Dockerfile` (multi-stage build with workaround + verification)
  - `backend/services/agent-runner/pyproject.toml` (1 line - dependency constraint)
  - `backend/services/agent-runner/poetry.lock` (regenerated)
- **No changes**: Agent-runner Python code, graphton, APIs, stigmer-server

## Related Work

### This Fixes the Earlier Misdiagnosis

Earlier today's changelog (`2026-02-14-123540-fix-agent-runner-deepagents-corruption.md`) documented excluding `deepagents==0.4.1` due to corrupted `__init__.py`. That fix was treating a **symptom** but missed the **root cause**:

- `deepagents==0.4.1` was not inherently corrupted
- `deepagents-cli` was overwriting it during installation
- Excluding `0.4.1` and downgrading to `0.4.0` didn't solve the problem because `0.4.0` also gets overwritten

The constraint added earlier (`deepagents = ">=0.4.0,!=0.4.1,<0.5.0"` in graphton/pyproject.toml) can remain for safety, but it was not the actual fix.

### Upstream Issue

The packaging defect should be reported to the upstream maintainers at `https://github.com/langchain-ai/deepagents/issues`. The `deepagents-cli` package should either:
1. Use a different namespace (`deepagents_cli/` instead of `deepagents/`)
2. Not ship files that belong to `deepagents`
3. Declare explicit conflicts/dependencies to prevent simultaneous installation

### Dependencies

- Commit `e4a7e0d1` (Feb 14, 2026): Earlier attempt to fix by excluding `deepagents==0.4.1`
- This fix supersedes and explains that earlier fix

## Testing

- ✅ Docker image builds successfully with verification gate passing
- ✅ Container starts and reaches healthy state
- ✅ Activity registration completes without errors
- ✅ Temporal worker polling for tasks on queue `agent_execution_runner`
- ✅ No import errors or SyntaxError in logs
- ✅ Container status: `Up (healthy)` - no restart loop
- ✅ Build-time verification catches corruption (tested by temporarily removing workaround)
- ✅ Both Docker tags point to fixed image

---

**Status**: ✅ Production Ready  
**Timeline**: Diagnosed and fixed in ~2 hours (including investigation of misdiagnosed root cause)  
**Critical Discovery**: Namespace collision between `deepagents` and `deepagents-cli` packages
