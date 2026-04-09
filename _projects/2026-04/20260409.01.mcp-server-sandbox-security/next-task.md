# Next Task: 20260409.01.mcp-server-sandbox-security

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260409.01.mcp-server-sandbox-security

**Description**: Move stdio MCP server execution from the agent-runner pod into the Daytona sandbox for security isolation, and automate snapshot management with pre-installed MCP server packages. Addresses the risk of running untrusted marketplace MCP servers inside the control plane container.
**Goal**: Isolate stdio MCP server execution in Daytona sandboxes (same sandbox used for workspace), automate snapshot lifecycle with popular MCP servers pre-installed, and clean up the agent-runner Dockerfile to no longer bundle MCP runtimes.
**Tech Stack**: Python (agent-runner, Graphton), Daytona SDK (Image, SnapshotService, Process API), Temporal workflows
**Components**: agent-runner (worker/mcp/, worker/activities/, sandbox Dockerfiles, config.py, sandbox_manager.py), Graphton middleware (core/middleware.py, core/mcp_manager.py), agent-runner Dockerfile

## Current State
- **Status**: in-progress
- **Last Session**: 2026-04-09 — T01 implemented + sandbox full CI pipeline + integration tests
- **Active Task**: T01 COMPLETE. T02 is next.
- **Branch**: `feat/mcp-marketplace-catalog`

## Session Progress (2026-04-09)

### T01: Sandbox Image Enhancement and Automated Snapshot Pipeline — COMPLETE
- Enhanced `Dockerfile.sandbox.basic` with Go toolchain and uv/uvx runtimes
- Enhanced `Dockerfile.sandbox.full` with Go toolchain, uv/uvx, python symlink, unzip
- Created `worker/snapshot_resolver.py` — Daytona-native snapshot discovery (no MongoDB)
- Created `worker/activities/build_mcp_snapshot.py` — Temporal workflow + activity for automated snapshot building and rotation
- Updated `worker/config.py` — snapshot resolution priority: env var > SnapshotResolver > no snapshot
- Updated `worker/worker.py` — registers BuildMcpSnapshot activity/workflow, initializes SnapshotResolver at startup

### Sandbox Full CI Pipeline and Integration Tests — COMPLETE
- Fixed `Dockerfile.sandbox.full`: updated header, added `python` symlink (needed by Daytona `Image.pip_install()`), added `unzip`
- Updated `release.sandbox.yaml` to build and push both basic (multi-arch) and full (amd64-only) images
- Updated `build_mcp_snapshot.py` to use `STIGMER_MCP_SNAPSHOT_BASE_IMAGE` defaulting to `agent-sandbox-full`
- Created integration tests (`test_snapshot_lifecycle.py`) validating resolver, snapshot creation, and rotation against live Daytona API
- **Test results**: 5 passed, 1 skipped (full-image pip_install test skips because `agent-sandbox-full` not yet published to GHCR)

### Key Design Decision
- **Daytona-native snapshot resolution** (no MongoDB): SnapshotResolver queries Daytona's snapshot.list() API directly, filters by `stigmer-mcp-` prefix, caches in-memory with 5-minute TTL. Single source of truth, no DB state to sync.

## Next Steps
1. **Publish full image**: Trigger `release.sandbox.yaml` CI pipeline (tag push or manual dispatch) to push `agent-sandbox-full` to GHCR
2. **Validate pip_install test**: Re-run `test_pip_install_on_full_image` after the image is published to confirm the `python` symlink works
3. **T02**: Move stdio MCP server execution from agent-runner pod into Daytona sandbox
4. **T03**: Integrate MCP server process management with Graphton middleware
5. **T04**: Clean up agent-runner Dockerfile — remove bundled MCP runtimes

## Context for Resume
- The `agent-sandbox-full` image has never been published to GHCR — the CI was just added this session
- `STIGMER_MCP_SNAPSHOT_BASE_IMAGE` is the new env var for snapshot builder base image (separate from `STIGMER_SANDBOX_IMAGE` used by OSS)
- The `SnapshotResolver` is a module-level singleton initialized in `AgentRunner.__init__` (cloud mode only)
- Integration tests use the dev Daytona API key from `stigmer-cloud/_ops/planton/service-hub/secrets-group/daytona.yaml`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with T02

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-04/20260409.01.mcp-server-sandbox-security/next-task.md`
