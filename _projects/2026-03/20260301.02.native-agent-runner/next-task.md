# Next Task: 20260301.02.native-agent-runner

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260301.02.native-agent-runner

**Description**: Migrate agent-runner from Docker container to native OS process using a hermetic CPython runtime bundle (python-build-standalone + wheelhouse/venv) managed by the Go CLI. Eliminates Docker Desktop as a prerequisite, removes the alarming home-directory mount warning, and brings agent-runner to parity with stigmer-server and workflow-runner as a simple daemon process.
**Goal**: Eliminate Docker dependency for agent-runner so all three daemon components (stigmer-server, workflow-runner, agent-runner) run as native OS processes started and managed by the Go CLI, with no Docker Desktop required for the core product.
**Tech Stack**: Go (CLI/daemon management), Python 3.11 (agent-runner), python-build-standalone (hermetic CPython), wheel packaging, CI/CD (per-platform wheelhouse builds)
**Components**: client-apps/cli/internal/cli/daemon/ (daemon lifecycle + health monitoring), client-apps/cli/embedded/ (binary extraction), backend/services/agent-runner/ (Python service), build pipeline (wheelhouse + runtime artifacts)

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
**Current Task**: T01.6 (End-to-End Validation)
**Status**: READY TO START

### Completed
- **T01.0**: Phase 1 plan reviewed and approved
- **T01.1**: Runtime filesystem layout designed and documented (DD-01)
- **T01.2**: Go package for Python runtime management implemented (`internal/cli/pythonrt/`)
- **T01.4**: Rewrite `startAgentRunner()` — Native Process Mode (daemon-only; supervisor out of scope)
- **T01.5**: Log Integration for Native Mode — verified and hardened
- **WA-01 Resolution**: Dual lifecycle management consolidated — single daemon as lifecycle owner (DD-02)

### WA-01 Resolution Summary (2026-03-01)
- **Problem**: Two independent systems (CLI daemon + stigmer-server supervisor) both managed agent-runner and workflow-runner with conflicting state files, competing health monitors, and no health monitoring for native agent-runner
- **Solution**: Created `stigmer internal-daemon` — a long-lived background process that is the single lifecycle owner for all components
- **Scope**: 25 files changed, ~3,400 lines removed, ~350 lines added
- **Key changes**:
  - Created `daemon_process.go` — long-lived daemon with health monitoring loop (5s interval), auto-restart, `health-state.json` output
  - Deleted `backend/services/stigmer-server/pkg/supervisor/` entirely (~580 lines)
  - Deleted `health_integration.go` (~520 lines of dead code)
  - Removed all Docker agent-runner code from daemon, logs, health, config, and reset packages
  - Removed `ResolveAgentRunnerMode`, mode constants, `AgentRunnerConfig` from config package
  - Removed `DockerContainerHealthCheck`, `AgentRunnerHealthCheck` from health package
  - Rewrote `server status` to read `health-state.json`, `server logs` to use file-only streaming
  - Refactored `StartWithOptions` to bootstrap Python runtime in foreground, spawn daemon via env vars
  - stigmer-server is now a pure backend service (no child process management)
- **Design Decision**: Documented as DD-02

### Next Up
- **T01.6**: End-to-End Validation — test complete flow on macOS arm64

### Key Design Decisions
- **DD-01**: `design-decisions/DD01_runtime_filesystem_layout.md` — Runtime lives at `~/.stigmer/runtimes/agent-runner/<cli-version>/<platform>/` with self-contained python/, venv/, wheels/, app/, and manifest.json
- **DD-01-A**: `app/` directory added for Python source code extraction
- **DD-02**: `design-decisions/DD02_single_daemon_lifecycle_owner.md` — Single long-lived daemon process as exclusive lifecycle owner for all components; supervisor removed
- **WA-01**: `wrong-assumptions/WA01_dual_lifecycle_management.md` — Resolved via DD-02

## Session Progress (2026-03-01)

### What Was Accomplished
- Reviewed T01_0_plan.md and approved the Phase 1 plan
- Deep-dived into existing codebase: daemon.go, supervisor.go, config.go, embedded package, agent-runner Dockerfile and pyproject.toml
- Identified three issues with the research report's proposed layout (ambiguous version key, over-engineered lock hash, split directory trees)
- Designed self-contained runtime layout with five key decisions documented (DD-01)
- **T01.2 completed**: Implemented `internal/cli/pythonrt/` — 7 files, 659 lines. Downloads python-build-standalone (CPython 3.11.14), extracts, creates venv, installs deps, exposes `EnsureReady()`. Atomic bootstrap, idempotent re-run (~34µs). Unit + integration tests passing on macOS arm64.
- **T01.4 completed**: Native agent-runner startup in daemon. Major findings during implementation:
  - **Dual lifecycle discovery**: Both daemon.go and supervisor.go manage agent-runner. StartWithOptions() starts stigmer-server which runs supervisor; the daemon's startAgentRunner was dead code. Solution: daemon now starts agent-runner natively and tells supervisor to skip via `STIGMER_SKIP_AGENT_RUNNER=true` env var.
  - **Go //go:embed limitation**: Can't embed files from outside module tree. Solution: build-tagged files with `os.DirFS` for dev and `//go:embed` for production after sync.sh copies source.
  - **WORKSPACE_ROOT vs SANDBOX_ROOT_DIR bug**: Fixed — native mode passes `SANDBOX_ROOT_DIR` directly.

### Context for Resume
- **T01.6 is next** — end-to-end validation of the full native agent-runner flow on macOS arm64
- The daemon is now a long-lived background process (`stigmer internal-daemon`); it starts, monitors, and restarts all components
- `daemon.pid` now contains the daemon's own PID (not stigmer-server's); `stigmer-server.pid` is a separate file
- `health-state.json` in the data dir provides real-time component status for `stigmer server status`
- supervisor.go is deleted — stigmer-server is a pure backend service
- All Docker agent-runner code is removed — agent-runner is always native
- `embedded/agentrunner/` package provides Python source as `fs.FS` — dev mode uses repo tree, production requires running `sync.sh` before build with `-tags embed_agentrunner`
- Some Docker-referencing comments remain in `embedded/` package files — these are informational and don't affect compilation

## Quick Commands

After loading context:
- "Start T01.6" — End-to-end validation on macOS arm64
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
