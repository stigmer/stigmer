---
name: Fix deepagents corruption v2
overview: Diagnose and fix the second `deepagents` package corruption causing the agent-runner crash loop. The error is a SyntaxError in `deepagents/middleware/subagents.py` line 482 within the installed `deepagents==0.4.0` package. This requires a diagnostic-first approach before any code changes.
todos:
  - id: diagnose-container
    content: "Phase 1: Run diagnostic checks -- inspect container, fresh PyPI download, and image timestamp to determine corruption source"
    status: completed
  - id: apply-fix
    content: "Phase 2: Apply the appropriate fix based on diagnostic results (rebuild image, downgrade version, or vendor patched copy)"
    status: completed
  - id: tighten-deps
    content: "Phase 3a: Tighten deepagents-cli version constraint from wildcard to pinned range"
    status: completed
  - id: build-time-verify
    content: "Phase 3b: Add build-time import verification step in Dockerfile to catch corrupted packages during build, not at runtime"
    status: completed
  - id: healthcheck-improve
    content: "Phase 3c: Enhance Dockerfile HEALTHCHECK to include deepagents import verification"
    status: completed
isProject: false
---

# Fix agent-runner crash loop: deepagents 0.4.0 corruption in [subagents.py](http://subagents.py)

## Situation

The agent-runner is in a crash loop, restarting every ~6 seconds and failing with the same error each time:

```
SyntaxError: invalid syntax (subagents.py, line 482)
    re(AgentMiddleware):
                       ^
```

**Import chain**: `main.py` -> `worker.register_activities()` -> `execute_graphton.py` -> `graphton.__init__` -> `graphton.core.agent` -> `deepagents.__init__` -> `deepagents.graph` -> `deepagents.middleware.__init__` -> `deepagents.middleware.subagents` (CRASH)

**This is the second corruption incident today** with the `deepagents` package. The first was an `IndentationError` in `__init__.py` from version `0.4.1`, fixed by excluding it and downgrading to `0.4.0` (changelog: `_changelog/2026-02/2026-02-14-123540-fix-agent-runner-deepagents-corruption.md`). Now `0.4.0` itself shows corruption in a different file.

## Phase 1: Diagnostic (must complete before any code changes)

We need to determine whether the corruption is in the PyPI source package or was introduced during Docker build/caching. These are **three independent checks** to run:

### Check 1: Inspect the running container

```bash
docker exec stigmer-agent-runner /app/.venv/bin/pip show deepagents
docker exec stigmer-agent-runner sed -n '475,490p' /app/.venv/lib/python3.11/site-packages/deepagents/middleware/subagents.py
```

This confirms which version is actually installed and shows the corrupted lines.

### Check 2: Download a fresh copy of deepagents 0.4.0 from PyPI

```bash
pip download deepagents==0.4.0 --no-deps -d /tmp/deepagents-check
cd /tmp/deepagents-check && unzip deepagents-0.4.0-py3-none-any.whl -d deepagents-0.4.0-contents
sed -n '475,490p' deepagents-0.4.0-contents/deepagents/middleware/subagents.py
```

This tells us whether the PyPI wheel itself is corrupted, or if it was corrupted during installation.

### Check 3: Verify Docker image freshness

```bash
docker inspect stigmer-agent-runner:local --format '{{.Created}}'
```

Compare this timestamp against the `make build-agent-runner-image` run from the earlier fix. If the image predates the fix, the container is running stale code.

## Phase 2: Fix (depends on Phase 1 results)

### Scenario A: Docker image is stale (most likely)

If the image creation timestamp predates the earlier fix, the container was never rebuilt. Fix:

```bash
docker build --no-cache -f backend/services/agent-runner/Dockerfile -t stigmer-agent-runner:local -t ghcr.io/stigmer/agent-runner:latest ../../..
docker rm -f stigmer-agent-runner
cd backend/services/agent-runner && docker compose up -d
```

No code changes needed -- just a proper rebuild.

### Scenario B: PyPI deepagents 0.4.0 is genuinely corrupted

If the fresh PyPI download also shows `re(AgentMiddleware):` at line 482, then the upstream package itself is broken. Options in order of preference:

1. **Check for older known-good versions** (e.g., `0.3.x`) -- update the constraint in [backend/libs/python/graphton/pyproject.toml](backend/libs/python/graphton/pyproject.toml) and verify API compatibility
2. **Pin `deepagents-cli` version constraint** in [backend/services/agent-runner/pyproject.toml](backend/services/agent-runner/pyproject.toml) (currently `deepagents-cli = "*"` -- this is dangerously loose)
3. **Vendor a patched copy** -- extract `deepagents==0.4.0`, fix the corrupted `subagents.py`, and install from local path
4. **Report upstream** at `https://github.com/langchain-ai/deepagents/issues`

### Scenario C: Corrupted during Docker build cache

If PyPI is clean but the container has corruption, the Docker build cache served a corrupt layer. Fix:

```bash
docker builder prune -f
make build-agent-runner-image  # (will rebuild from scratch)
```

## Phase 3: Harden against recurrence

Regardless of which scenario, the `deepagents` dependency has now corrupted twice in one day. Two hardening measures:

### 3a. Tighten `deepagents-cli` constraint

In [backend/services/agent-runner/pyproject.toml](backend/services/agent-runner/pyproject.toml) line 38, change:

```toml
deepagents-cli = "*"     # current: accepts ANY version
```

to:

```toml
deepagents-cli = ">=0.0.3,<0.1.0"  # pin to known-good range
```

### 3b. Add a startup import smoke test to Dockerfile HEALTHCHECK

The current healthcheck in [backend/services/agent-runner/Dockerfile](backend/services/agent-runner/Dockerfile) line 109-110 only checks `worker.config`. Consider adding `deepagents` to the import check so corrupted installs fail the health check faster:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD /app/.venv/bin/python -c "from deepagents.middleware.subagents import SubAgentMiddleware; from worker.config import Config" || exit 1
```

### 3c. Add a build-time verification step

Add a `RUN` step after dependency installation in the Dockerfile builder stage to fail the build immediately if `deepagents` is corrupt:

```dockerfile
RUN /app/.venv/bin/python -c "from deepagents.middleware.subagents import SubAgentMiddleware; print('deepagents import OK')"
```

## Key files

- [backend/libs/python/graphton/pyproject.toml](backend/libs/python/graphton/pyproject.toml) -- `deepagents` version constraint (line 21)
- [backend/services/agent-runner/pyproject.toml](backend/services/agent-runner/pyproject.toml) -- `deepagents-cli` constraint (line 38)
- [backend/services/agent-runner/poetry.lock](backend/services/agent-runner/poetry.lock) -- locked version (line 782)
- [backend/services/agent-runner/Dockerfile](backend/services/agent-runner/Dockerfile) -- builder + healthcheck
- [Makefile](Makefile) -- `build-agent-runner-image` target (line 347)

