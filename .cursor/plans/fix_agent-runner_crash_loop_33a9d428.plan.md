---
name: Fix agent-runner crash loop
overview: The agent-runner Docker container is crash-looping due to a SyntaxError introduced by commit 3349c764 ("clean up trailing whitespace"). The automated whitespace cleanup accidentally merged two lines in graphton's core/__init__.py, concatenating an import statement with the __all__ assignment.
todos:
  - id: fix-init-py
    content: Restore newline between import and __all__ in graphton/core/__init__.py (line 22)
    status: completed
  - id: fix-trailing-newline
    content: Restore trailing newline in skill_client.py
    status: completed
  - id: rebuild-restart
    content: Rebuild Docker image and restart the agent-runner container
    status: completed
  - id: verify-healthy
    content: Verify container starts healthy with no crash loop
    status: completed
isProject: false
---

# Fix Agent-Runner SyntaxError Crash Loop

## Root Cause

Commit `3349c764` ("docs: update CLI TUI project status and clean up formatting") performed an automated trailing whitespace cleanup that went wrong. In `[backend/libs/python/graphton/src/graphton/core/__init__.py](backend/libs/python/graphton/src/graphton/core/__init__.py)`, it ate the newline between line 22 (an import) and the `__all__` assignment, fusing them into a single invalid line:

**Before (correct):**

```python
from graphton.core.token_counter import TokenCounter, TokenCountingError

__all__ = [
```

**After (broken):**

```python
from graphton.core.token_counter import TokenCounter, TokenCountingError__all__ = [
```

Python parses `TokenCountingError__all__` as one identifier, then hits `= [` which is illegal inside an `import` statement -- hence `SyntaxError: invalid syntax` at line 22.

The same commit also stripped the trailing newline from `[backend/services/agent-runner/grpc_client/skill_client.py](backend/services/agent-runner/grpc_client/skill_client.py)`. This is harmless at runtime but should be restored for POSIX compliance.

## Crash Timeline

1. **13:01 IST** -- Commit `3349c764` pushed to `main` with the broken `__init__.py`
2. **13:05 IST** -- Docker image `ghcr.io/stigmer/agent-runner:latest` rebuilt (image `d810d2c1b7d3`)
3. **13:05 IST** -- Container `stigmer-agent-runner` created from the broken image
4. **Since then** -- Container crash-looping (26 restarts and counting) with `--restart unless-stopped`

## Fix (2 files, no architectural changes)

### 1. Restore the newline in `graphton/core/__init__.py`

Split line 22 back into three lines: the import, a blank separator, and the `__all__` assignment.

```22:22:backend/libs/python/graphton/src/graphton/core/__init__.py
from graphton.core.token_counter import TokenCounter, TokenCountingError__all__ = [
```

becomes:

```python
from graphton.core.token_counter import TokenCounter, TokenCountingError

__all__ = [
```

### 2. Restore trailing newline in `skill_client.py`

Add back the missing trailing newline at end of file (POSIX convention, and it was there before the cleanup commit).

### 3. Rebuild Docker image and restart container

```bash
make build-agent-runner-image
docker rm -f stigmer-agent-runner
cd backend/services/agent-runner && docker compose up -d
```

### 4. Verify healthy startup

```bash
docker logs --tail 10 stigmer-agent-runner
stigmer server status
```

Expected: "Activities registered successfully" and "Worker ready, polling for tasks..." with zero restarts.