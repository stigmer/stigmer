# Next Task: 20260301.02.native-agent-runner

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260301.02.native-agent-runner

**Description**: Migrate agent-runner from Docker container to native OS process using a hermetic CPython runtime bundle (python-build-standalone + wheelhouse/venv) managed by the Go CLI. Eliminates Docker Desktop as a prerequisite, removes the alarming home-directory mount warning, and brings agent-runner to parity with stigmer-server and workflow-runner as a simple daemon process.
**Goal**: Eliminate Docker dependency for agent-runner so all three daemon components (stigmer-server, workflow-runner, agent-runner) run as native OS processes started and managed by the Go CLI, with no Docker Desktop required for the core product.
**Tech Stack**: Go (CLI/daemon management), Python 3.11 (agent-runner), python-build-standalone (hermetic CPython), wheel packaging, CI/CD (per-platform wheelhouse builds)
**Components**: client-apps/cli/internal/cli/daemon/ (daemon lifecycle), client-apps/cli/embedded/ (binary extraction), backend/services/agent-runner/ (Python service), backend/services/stigmer-server/pkg/supervisor/ (health monitoring), build pipeline (wheelhouse + runtime artifacts)

## Research Foundation

This project is based on deep research findings in:
- `_projects/2026-03/20260301.050000.research.eliminate-docker-for-agent-runner/04.report.gpt.md`

**Recommended approach**: Hermetic CPython runtime bundle (python-build-standalone) + wheelhouse/venv, installed and managed by the Go CLI. Ship CPython like a runtime — exactly what uv and python-build-standalone are designed to enable.

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
_projects/2026-03/20260301.02.native-agent-runner/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
_projects/2026-03/20260301.02.native-agent-runner/tasks/
```

### 3. Project Documentation
- **README**: `_projects/2026-03/20260301.02.native-agent-runner/README.md`

### 4. Research Report
- **Deep Research**: `_projects/2026-03/20260301.050000.research.eliminate-docker-for-agent-runner/04.report.gpt.md`

## Key Source Files

### Agent-Runner (Python)
- `backend/services/agent-runner/pyproject.toml` — Dependencies with native extensions
- `backend/services/agent-runner/Dockerfile` — Current Docker image (to be replaced)
- `backend/services/agent-runner/main.py` — Entry point

### CLI Daemon Management (Go)
- `client-apps/cli/internal/cli/daemon/daemon.go` — Docker lifecycle (to be rewritten)
- `backend/services/stigmer-server/pkg/supervisor/supervisor.go` — Health monitoring

### Previous Migration
- `_changelog/2026-01/2026-01-22-020000-migrate-agent-runner-to-docker.md` — Why Docker was adopted
- `_projects/2026-01/20260122.01.migrate-agent-runner-to-docker/` — Original Docker migration project

## Knowledge Folders to Check

### Design Decisions
```
_projects/2026-03/20260301.02.native-agent-runner/design-decisions/
```

### Coding Guidelines
```
_projects/2026-03/20260301.02.native-agent-runner/coding-guidelines/
```

### Wrong Assumptions
```
_projects/2026-03/20260301.02.native-agent-runner/wrong-assumptions/
```

### Don't Dos
```
_projects/2026-03/20260301.02.native-agent-runner/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-01
**Current Task**: T01.4 (Rewrite startAgentRunner — Native Process Mode)
**Status**: READY TO START

### Completed
- **T01.0**: Phase 1 plan reviewed and approved
- **T01.1**: Runtime filesystem layout designed and documented (DD-01)
- **T01.2**: Go package for Python runtime management implemented (`internal/cli/pythonrt/`)

### Next Up
- **T01.4**: Rewrite `startAgentRunner()` in daemon.go and supervisor.go — wire pythonrt.EnsureReady(), start agent-runner as native process

### Key Design Decision
- **DD-01**: `design-decisions/DD01_runtime_filesystem_layout.md` — Runtime lives at `~/.stigmer/runtimes/agent-runner/<cli-version>/<platform>/` with self-contained python/, venv/, wheels/, and manifest.json

## Session Progress (2026-03-01)

### What Was Accomplished
- Reviewed T01_0_plan.md and approved the Phase 1 plan
- Deep-dived into existing codebase: daemon.go, supervisor.go, config.go, embedded package, agent-runner Dockerfile and pyproject.toml
- Identified three issues with the research report's proposed layout (ambiguous version key, over-engineered lock hash, split directory trees)
- Designed self-contained runtime layout with five key decisions documented (DD-01)
- **T01.2 completed**: Implemented `internal/cli/pythonrt/` — 7 files, 659 lines. Downloads python-build-standalone (CPython 3.11.14), extracts, creates venv, installs deps, exposes `EnsureReady()`. Atomic bootstrap, idempotent re-run (~34µs). Unit + integration tests passing on macOS arm64.

### Context for Resume
- **pythonrt package** is standalone; T01.4 will wire it into daemon.go and supervisor.go. Bootstrap runs in daemon before stigmer-server starts; supervisor receives paths via env vars.
- Workflow-runner uses a "BusyBox" pattern; agent-runner cannot (Python). T01.4 will start agent-runner as `<venv>/bin/python main.py` subprocess.
- `PostInstallCmds` in pythonrt Config handles the `deepagents-cli` namespace collision (e.g., `["pip", "install", "--force-reinstall", "deepagents==0.4.0"]`).
- Known issue for T01.4: daemon passes `WORKSPACE_ROOT` but agent-runner reads `SANDBOX_ROOT_DIR` — fix when wiring native startup.

## Quick Commands

After loading context:
- "Start T01.4" - Wire pythonrt into daemon.go and supervisor.go
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
