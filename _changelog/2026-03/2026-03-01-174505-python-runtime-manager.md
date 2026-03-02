# Add Python Runtime Manager for Agent-Runner Native Mode

**Date**: March 1, 2026

## Summary

Implemented a new Go package `internal/cli/pythonrt/` that manages the complete lifecycle of a hermetic CPython runtime for agent-runner. The package downloads python-build-standalone (CPython 3.11.14), extracts it, creates a virtual environment, installs dependencies, and exposes a single `EnsureReady()` entry point. This is the foundation for eliminating Docker as a prerequisite for agent-runner — Phase 1 of the native-agent-runner migration.

## Problem Statement

Agent-runner currently runs inside a Docker container, which requires Docker Desktop and triggers an alarming "home directory shared with container" warning. The goal is to run agent-runner as a native OS process, like stigmer-server and workflow-runner, with no Docker prerequisite for the core product.

### Pain Points

- Docker Desktop required for `stigmer server start`
- Home directory mount warning alarms users
- PyInstaller/frozen-binary approaches failed in Jan 2026 (dynamic imports, namespace collisions)
- Need hermetic CPython with normal `import` semantics — same as what Docker provides

## Solution

A hermetic CPython runtime bundle (python-build-standalone) + wheelhouse/venv, installed and managed by the Go CLI. The CLI downloads the appropriate PBS tarball for the current platform, verifies its SHA-256 checksum, extracts it, creates a venv, and installs dependencies — either from a local wheelhouse (when T01.3 delivers it) or from the network.

### Key Design Decisions

- **Version key**: CLI build version (`embedded.GetBuildVersion()`), not agent-runner or Python version
- **Layout**: `~/.stigmer/runtimes/agent-runner/<cli-version>/<platform>/` with `python/`, `venv/`, `wheels/`, `manifest.json` (per DD-01)
- **Atomic bootstrap**: If any step fails, the entire runtime directory is removed — no partial state
- **Idempotent**: Second `EnsureReady()` call is a fast no-op (~34µs) when manifest is valid
- **Post-install fixups**: Caller provides `PostInstallCmds` (e.g., deepagents namespace collision workaround) — pythonrt stays generic

## Implementation Details

### Package Structure

| File | Responsibility | Lines |
|------|----------------|-------|
| `checksums.go` | Pinned Python 3.11.14, PBS tag 20260211, SHA-256 for 4 platforms | 22 |
| `platform.go` | Platform value object, Go→PBS naming map | 68 |
| `manifest.go` | Manifest read/write/validation | 59 |
| `download.go` | Download via httputil, SHA-256 verification | 91 |
| `extract.go` | Tar.gz extraction, path traversal protection, macOS quarantine cleanup | 119 |
| `venv.go` | Venv creation, pip install (wheelhouse or network), post-install commands | 84 |
| `manager.go` | Config/Manager, EnsureReady orchestration | 216 |
| `pythonrt_test.go` | Unit + integration tests | 235 |

**Total**: 659 lines of production code across 7 files.

### Platform Support

- `darwin-arm64` (Apple Silicon)
- `darwin-amd64` (Intel Mac)
- `linux-amd64`
- `linux-arm64`

Uses glibc-based Linux builds only — musl is incompatible with many native extension wheels (grpcio, temporalio).

### API

```go
cfg := pythonrt.Config{
    BaseDir:        "~/.stigmer/runtimes/agent-runner",
    CLIVersion:     embedded.GetBuildVersion(),
    DepsSource:     "path/to/requirements.txt",
    WheelDir:       "",  // optional: offline wheelhouse
    PostInstallCmds: [][]string{{"pip", "install", "--force-reinstall", "deepagents==0.4.0"}},
}
mgr, _ := pythonrt.NewManager(cfg)
mgr.EnsureReady(ctx)  // download + extract + venv + install (or fast no-op)
mgr.PythonBin()      // venv/bin/python
```

## Benefits

- **No Docker on first run**: Users can run `stigmer server start` without Docker Desktop
- **Supply-chain integrity**: Hardcoded SHA-256 checksums; no MITM risk
- **Fast subsequent starts**: Manifest check only; no re-download
- **Atomic upgrades**: CLI version mismatch triggers full re-bootstrap; old version dir retained until cleanup
- **Testable**: Unit tests for platform mapping, manifest serialization; integration test for full bootstrap

## Impact

- **Developers**: New `internal/cli/pythonrt/` package; no changes to existing daemon or supervisor yet
- **T01.4**: Will wire pythonrt into daemon.go and supervisor.go to start agent-runner as native process
- **T01.3**: Will produce per-platform wheelhouse; pythonrt already supports `Config.WheelDir`

## Related Work

- **DD-01**: `_projects/2026-03/20260301.02.native-agent-runner/design-decisions/DD01_runtime_filesystem_layout.md` — Runtime layout specification
- **Research**: `_projects/2026-03/20260301.050000.research.eliminate-docker-for-agent-runner/04.report.gpt.md` — Recommended hermetic CPython approach
- **Docker migration**: `_changelog/2026-01/2026-01-22-020000-migrate-agent-runner-to-docker.md` — Why Docker was adopted (now being replaced)

---

**Status**: Production Ready  
**Timeline**: Single session (~2 hours)  
**Verified**: macOS arm64 — full bootstrap ~9s, idempotent re-run 34µs
