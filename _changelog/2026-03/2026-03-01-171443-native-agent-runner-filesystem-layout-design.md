# Native Agent-Runner: Runtime Filesystem Layout Design (DD-01)

**Date**: March 1, 2026

## Summary

Designed and documented the runtime filesystem layout for the native agent-runner migration — the foundational design decision (DD-01) that establishes where the hermetic CPython runtime, virtual environment, wheelhouse, and metadata live on disk. This is the first deliverable of Phase 1 in the project to eliminate Docker Desktop as a prerequisite for Stigmer.

## Problem Statement

Agent-runner currently runs inside a Docker container, which requires Docker Desktop on macOS, produces an alarming "home directory shared with container" warning, and makes agent-runner the only Stigmer daemon component that cannot run as a simple native process. The migration to a native process backed by python-build-standalone needs a well-defined filesystem layout before any code is written.

### Pain Points

- No established convention for where a hermetic Python runtime should live within `~/.stigmer/`
- The research report's proposed layout had three issues: ambiguous version key, over-engineered lock-hash-based wheelhouse cache, and split directory trees requiring coordinated cleanup
- Existing `~/.stigmer/` layout has inconsistencies between Temporal/Ollama paths and daemon component paths that the new design must not inherit

## Solution

A self-contained runtime layout at `~/.stigmer/runtimes/agent-runner/<cli-version>/<platform>/` where the Python interpreter, virtual environment, cached wheels, and a manifest.json all colocate under a single version-specific directory. Runtime state (logs, PID files, workspace, artifacts) remains in the existing `~/.stigmer/data/` directory.

## Implementation Details

### Directory Structure

```
~/.stigmer/runtimes/agent-runner/<cli-version>/<platform>/
├── python/          # python-build-standalone extracted
├── venv/            # virtual environment with all dependencies
├── wheels/          # cached wheelhouse for offline reinstall
└── manifest.json    # environment metadata (schema_version, cli_version, python_version, etc.)
```

### Five Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Placement | `~/.stigmer/runtimes/` (peer of `data/`) | Tools vs state separation |
| Version key | CLI build version (`embedded.GetBuildVersion()`) | CLI orchestrates and pins everything |
| Wheel caching | Inside version directory | Self-contained cleanup, enables reinstall |
| Platform identifiers | `GOOS-GOARCH` (e.g., `darwin-arm64`) | Go convention, already used by CLI |
| Multi-version retention | Yes, old versions kept until cleanup | Atomic upgrades, rollback capability |

### Alternatives Analyzed and Rejected

1. **Separated runtime/env trees** — premature abstraction, coordination overhead
2. **No platform directory level** — loses CI build matrix alignment and cross-arch safety
3. **Content-addressable wheelhouse** (`<lockHash>`) — opaque paths, complexity without benefit
4. **Single mutable runtime** (no versioning) — no rollback, risky upgrades

## Benefits

- Clean separation of immutable tools (`runtimes/`) from mutable state (`data/`)
- Single `rm -rf <version>/` cleans an entire runtime environment
- Trivial freshness check: compare `manifest.cli_version` to running CLI version
- Forward-compatible: `schema_version` in manifest allows format evolution
- Estimated ~350 MB per version — acceptable for a development tool

## Impact

- Establishes the filesystem contract that T01.2 (Go runtime manager), T01.3 (CI wheelhouse pipeline), and T01.4 (native process startup) will build on
- No code changes to existing components — this is a design document only
- Surfaces existing tech debt: path inconsistencies, container ID naming mismatch

## Related Work

- Research report: `_projects/2026-03/20260301.050000.research.eliminate-docker-for-agent-runner/04.report.gpt.md`
- Prior PyInstaller decision (superseded): `_projects/2026-01/20260121.03.agent-runner-standalone-binary/design-decisions/001-pyinstaller-over-docker.md`
- Docker migration changelog: `_changelog/2026-01/2026-01-22-020000-migrate-agent-runner-to-docker.md`

---

**Status**: Production Ready
**Timeline**: T01.1 of Phase 1 (native-agent-runner migration)
