# Task T01: Runtime Bootstrap & Build Pipeline

**Created**: 2026-03-01
**Status**: PENDING REVIEW
**Type**: Migration — Phase 1 Foundation

> **This plan requires your review before execution.**

## Context

Based on the [deep research report](../../20260301.050000.research.eliminate-docker-for-agent-runner/04.report.gpt.md), the recommended approach is **hermetic CPython runtime bundle (python-build-standalone) + wheelhouse/venv, managed by the Go CLI**. This is the lowest-risk path because it gives agent-runner the same import semantics as Docker (real CPython + real site-packages) while eliminating Docker Desktop entirely.

The research explicitly warns against frozen-binary tools (PyInstaller, Nuitka, cx_Freeze) — they have **not** solved the dynamic import / namespace collision problems that caused our January 2026 failure. The recommended path is to "ship CPython like a runtime."

## High-Level Migration Phases

| Phase | Scope | Estimated Duration |
|-------|-------|--------------------|
| **Phase 1** | Hermetic runtime bootstrap + build pipeline + dual-path execution | 1.5–2 weeks |
| **Phase 2** | Decouple MCP runtime dependencies (tiered policy) | 0.5–1 week |
| **Phase 3** | Remove Docker from core path, retain as optional sandbox | 0.5 week |

This task plan covers **Phase 1** — the foundation.

## Phase 1 Objective

Build the infrastructure to download, install, and manage a hermetic CPython runtime for agent-runner, produce per-platform wheelhouse artifacts in CI, and run agent-runner as a native daemon process — while keeping Docker as a fallback.

---

## Task Breakdown

### T01.1: Define Runtime Filesystem Layout

Design the directory structure under `~/.stigmer/` for the native agent-runner runtime.

**Proposed layout** (from research):
```
~/.stigmer/
├── runtimes/
│   └── agent-runner/
│       └── <version>/
│           └── <platform>/          # e.g., darwin-arm64, linux-amd64
│               ├── python/          # python-build-standalone extracted here
│               └── venv/            # app venv with all dependencies installed
├── cache/
│   └── wheels/
│       └── <lockHash>/
│           └── <platform>/          # pre-built wheelhouse for offline install
```

**Deliverable**: Document the layout in a design decision file. Define version scheme and platform identifiers.

### T01.2: Go CLI — Python Runtime Manager

Implement a new Go package (`internal/cli/pythonrt/` or similar) in the CLI that handles:

1. **Detect OS/arch** at runtime (darwin/arm64, darwin/amd64, linux/amd64, linux/arm64)
2. **Download python-build-standalone** distribution for the detected platform
   - Source: GitHub releases from `astral-sh/python-build-standalone` (or Astral CDN)
   - Verify checksum/signature
   - Extract to `~/.stigmer/runtimes/agent-runner/<version>/<platform>/python/`
3. **Create venv** using the downloaded Python
4. **Install dependencies** from a local wheelhouse (bundled with CLI or downloaded separately)
   - Handle the `deepagents-cli` namespace collision: install in controlled order + repair step
5. **Version management**: detect when runtime needs update (version mismatch, lock hash change)

**Key design decisions**:
- Should the wheelhouse be embedded in the CLI binary, downloaded separately, or shipped as a sidecar artifact?
- How to handle first-run vs subsequent runs (idempotency)
- Download timeout / retry / proxy handling

**Deliverable**: Working Go package that can bootstrap a CPython environment from scratch on macOS arm64.

### T01.3: Per-Platform Wheelhouse Build Pipeline

Set up CI (GitHub Actions) to produce wheelhouse artifacts:

1. **Matrix build**: macOS arm64, macOS amd64, Linux amd64, Linux arm64
2. For each platform:
   - Use python-build-standalone Python 3.11
   - `pip wheel` all dependencies from the locked `pyproject.toml` / `poetry.lock`
   - Build local packages (`graphton`, `stigmer-stubs`) into wheels
   - Apply `deepagents-cli` collision fix during build
   - Package as a compressed archive (tar.gz per platform)
3. **Verify**: test-install into a clean venv on each platform, import critical modules (`temporalio`, `grpcio`, `deepagents`, `multipart`)
4. **Publish**: upload wheelhouse archives as release artifacts (or to a storage bucket)

**Important**: Use glibc-based Linux builds, NOT musl — the research explicitly warns that musl builds are incompatible with many native extension wheels.

**Deliverable**: CI workflow that produces verified wheelhouse archives for 4 platforms.

### T01.4: Rewrite `startAgentRunner()` — Native Process Mode

Modify `daemon.go` and `supervisor.go` to start agent-runner as a native process instead of Docker:

1. **New startup flow**:
   - Call the Python runtime manager (T01.2) to ensure runtime is bootstrapped
   - Start `<venv>/bin/python main.py` as a subprocess
   - Manage via PID file (like workflow-runner), not container ID
   - Redirect stdout/stderr to `~/.stigmer/data/logs/agent-runner.log`
   - Pass environment variables directly (no Docker `-e` flags)

2. **Dual-path execution** (safety net):
   - Add a config flag or env var: `STIGMER_AGENT_RUNNER_MODE=native|docker`
   - Default to `native` on macOS arm64
   - Fall back to `docker` if runtime bootstrap fails or if user explicitly sets docker mode
   - Keep all existing Docker code intact during Phase 1

3. **Update health monitoring**:
   - `supervisor.go`: check process health via PID (already have this pattern for workflow-runner)
   - Remove Docker-specific health checks when in native mode

4. **Update stop/cleanup**:
   - `stopAgentRunner()`: kill process by PID when in native mode
   - `cleanupOrphanedProcesses()`: clean up native agent-runner PID file

**Deliverable**: `stigmer server start` can launch agent-runner as a native process on macOS arm64, with Docker fallback.

### T01.5: Log Integration for Native Mode

Update `server_logs.go` to handle agent-runner logs from file (native mode) in addition to Docker logs:

- When native mode: stream from `~/.stigmer/data/logs/agent-runner.log` (same as workflow-runner pattern)
- When docker mode: existing `docker logs` streaming

**Deliverable**: `stigmer server logs --component agent-runner` works in both modes.

### T01.6: End-to-End Validation

Test the complete flow on macOS arm64:

1. `stigmer server start` — bootstraps Python runtime on first run, starts agent-runner natively
2. `stigmer server status` — shows agent-runner running with PID (not container ID)
3. `stigmer server logs --component agent-runner` — streams logs from file
4. `stigmer run agent` — executes an agent successfully through the native agent-runner
5. `stigmer server stop` — cleanly stops the native process
6. Docker fallback works when native mode is disabled

**Acceptance criteria**:
- [ ] No Docker Desktop required for `stigmer server start`
- [ ] No "home directory shared with container" warning
- [ ] Agent execution completes successfully
- [ ] Startup time < 1s (after first bootstrap)
- [ ] Runtime + venv size < 200MB on disk
- [ ] Docker fallback works when configured

---

## Risks Specific to Phase 1

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Missing wheels for temporalio on some platform | Medium | High | Build wheels ourselves in CI; test all 4 platforms |
| `deepagents` namespace collision in venv | High | Medium | Controlled install order + repair step, same as Docker workaround |
| python-build-standalone download failures (proxy/firewall) | Low | Medium | Offline wheelhouse option; bundle in CLI release |
| macOS quarantine blocks downloaded Python binary | Low | High | `xattr -d com.apple.quarantine` in bootstrap; test on clean macOS |
| Go subprocess management edge cases (zombie processes) | Low | Medium | Reuse existing workflow-runner PID management patterns |

## Dependencies on External Work

- **python-build-standalone releases** must have Python 3.11 builds for all 4 target platforms (they do today)
- **Wheel availability**: `temporalio`, `grpcio`, `deepagents` must publish wheels for target platforms (verify in T01.3)

## What Phase 2 Looks Like (Preview)

After Phase 1 is stable:
- Remove Node.js/Go/Docker CLI from the agent-runner runtime
- Implement tiered MCP server policy:
  - Tier A: Python MCP servers (work out of the box — agent-runner already has CPython)
  - Tier B: Node MCP servers (lazy-install Node.js on demand)
  - Tier C: Go MCP servers (prefer prebuilt binaries over `go run`)
  - Tier D: Docker MCP servers (optional, user-provided Docker)

## What Phase 3 Looks Like (Preview)

- Remove Docker as default in `daemon.go` and `supervisor.go`
- Docker becomes an optional config for MCP sandbox isolation only
- Clean up Docker-specific code paths, container ID management, etc.
- Update onboarding docs: remove Docker as prerequisite

---

## Review Process

**What happens next**:
1. **You review this plan** — consider the approach, phasing, and risks
2. **Provide feedback** — concerns, scope adjustments, priority changes
3. **I'll revise the plan** — create T01_2_revised_plan.md incorporating feedback
4. **You approve** — give explicit go-ahead
5. **Execution begins** — tracked in T01_3_execution.md

**Please consider**:
- Is the dual-path (native + Docker fallback) approach right for Phase 1?
- Should we target macOS arm64 only first, or all platforms simultaneously?
- Should the wheelhouse be bundled in the CLI release artifact, or downloaded separately on first run?
- Is the `~/.stigmer/runtimes/` layout appropriate, or should it live elsewhere?
- Any concerns about the python-build-standalone supply chain?
