# Fix Agent-Runner Crash Loop and Add Python Linting Gates

**Date**: February 17, 2026

## Summary

Resolved a recurring agent-runner crash loop caused by a fused import/`__all__` line in `graphton/core/__init__.py`, then replaced the patch-up Dockerfile import check with proper linting gates: a pre-commit framework and Python coverage in `make lint`. This is the second occurrence of this exact bug (first was Feb 15) and the fix addresses both the symptom and the root cause.

## Problem Statement

The agent-runner Docker container entered a crash loop with `SyntaxError: invalid syntax` on startup. The error occurred at line 22 of `backend/libs/python/graphton/src/graphton/core/__init__.py`, where an automated whitespace cleanup tool fused the last import statement with the `__all__` declaration:

```python
# Broken (fused line)
from graphton.core.token_counter import TokenCounter, TokenCountingError__all__ = [

# Correct (separate lines)
from graphton.core.token_counter import TokenCounter, TokenCountingError

__all__ = [
```

### Pain Points

- This is the **second time** this exact bug has caused a production crash loop (first on Feb 15, now Feb 17)
- There were **zero automated gates** between an editor save and a Docker image build for Python code
- `make lint` covered Go and proto only -- agent-runner and graphton Python code was invisible to it
- No pre-commit hooks existed in the repository
- The Dockerfile's import verification step didn't cover the `graphton.core` module that kept breaking
- The initial fix (adding a graphton import check to the Dockerfile) was a patch-up, not a proper solution

## Solution

### 1. Fix the Syntax Error

Restored the missing line break in `backend/libs/python/graphton/src/graphton/core/__init__.py` between the import statement and `__all__` declaration. Rebuilt the Docker image and restarted the container -- agent-runner returned to healthy with 0 restarts.

### 2. Add Pre-Commit Framework

Created `.pre-commit-config.yaml` at repo root with:

- **`trailing-whitespace`** (pre-commit-hooks v6.0.0): The single most important hook. Does whitespace cleanup **correctly** -- trims trailing spaces but preserves blank lines. This replaces the rogue editor/tool cleanup that caused both crash loops.
- **`end-of-file-fixer`**: Ensures POSIX-compliant file endings.
- **`check-yaml`**: Validates YAML syntax.
- **`check-added-large-files`**: Prevents accidental large file commits.
- **`ruff-check`** (ruff-pre-commit v0.15.1): Catches Python syntax errors, unused imports, and style violations in milliseconds at commit time. Brings its own binary -- no dependency on project Poetry environments.

### 3. Add Python Linting to `make lint`

Extended the `lint` target with two `ruff check` invocations:

- `cd backend/libs/python/graphton && poetry run ruff check .`
- `cd backend/services/agent-runner && poetry run ruff check .`

Two separate invocations because each project has different ruff rule sets in its `pyproject.toml` (graphton enables `D`, `ANN` rules that agent-runner doesn't). Running from each project's directory ensures `ruff` reads the correct config.

### 4. Add Setup Hooks Integration

- New `setup-hooks` Makefile target for explicit pre-commit installation
- Updated `setup` target to auto-install hooks when `pre-commit` is available, with a helpful note when it isn't

### 5. Clean Up Dockerfile

Reverted the Dockerfile to deepagents-only import verification. Added a comment explaining that the deepagents check exists specifically for the namespace collision workaround (a runtime packaging defect that linters cannot detect), and that Python syntax errors in first-party code are now caught by pre-commit hooks and `make lint`.

### 6. Expand mypy Scope

Extended `build-backend` mypy invocation to include `../../libs/python/graphton/src/` alongside the existing `grpc_client/` and `worker/` directories. This catches type errors in graphton at `make build-backend` time.

## Benefits

### Immediate

- Agent-runner crash loop resolved, service healthy with 0 restarts
- The root cause (rogue whitespace cleanup) is now prevented by `trailing-whitespace` hook
- Python syntax errors caught at commit time, not Docker runtime

### Developer Experience

- `make lint` now covers the entire codebase: Go, proto, and Python
- `make setup` auto-installs hooks -- zero friction for new developers
- Pre-commit hooks run in milliseconds -- no slowdown to the commit workflow

### Architecture

- Each gate checks what it's best at: pre-commit for syntax/whitespace, `make lint` for full linting, Dockerfile only for runtime packaging defects
- The Dockerfile comment explains the design rationale so future maintainers don't re-add redundant checks

## Impact

### Who/What is Affected

- All developers committing Python code now get automatic linting
- `make lint` users now get Python coverage alongside Go and proto
- Docker builds are cleaner -- only verify what linters genuinely cannot

### Scope

**Changed files**:
- `backend/libs/python/graphton/src/graphton/core/__init__.py` -- 1 line fix (split fused import/`__all__`)
- `backend/services/agent-runner/Dockerfile` -- reverted to deepagents-only check, updated comments
- `Makefile` -- added `setup-hooks` target, pre-commit to `setup`, Python to `lint`, graphton to `build-backend` mypy
- `.pre-commit-config.yaml` -- new file, pre-commit framework configuration

**Changed artifacts**:
- Docker image `ghcr.io/stigmer/agent-runner:latest` -- rebuilt from fixed source
- Running container `stigmer-agent-runner` -- replaced with fixed version

## Related Work

- [2026-02-15 Fix Agent-Runner Syntax Error Crash Loop](_changelog/2026-02/2026-02-15-133144-fix-agent-runner-syntax-error-crash-loop.md) -- first occurrence of this exact bug
- [2026-02-14 Fix Agent-Runner Deepagents Corruption](_changelog/2026-02/2026-02-14-123540-fix-agent-runner-deepagents-corruption.md) -- the deepagents namespace collision that the Dockerfile check was originally added for

Both previous incidents recommended adding pre-commit hooks and broader linting gates. This changelog implements those recommendations.

## Testing

- `ruff check` on `graphton/core/__init__.py` passes (syntax error fixed)
- `stigmer server status` shows Agent Runner healthy with 0 restarts
- `.pre-commit-config.yaml` uses pinned versions (pre-commit-hooks v6.0.0, ruff-pre-commit v0.15.1)
- Pre-existing Go vet and Python ruff violations exist in the codebase (separate cleanup task); new gates correctly report them

---

**Status**: Production Ready
**Timeline**: Investigation, fix, and linting gate implementation completed in ~1 hour
