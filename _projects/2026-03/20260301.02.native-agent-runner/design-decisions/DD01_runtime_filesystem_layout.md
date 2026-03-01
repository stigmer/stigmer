# DD-01: Runtime Filesystem Layout for Native Agent-Runner

**Date**: 2026-03-01
**Status**: Decided
**Supersedes**: Docker-based agent-runner layout (container volumes + container ID files)

## Decision

The native agent-runner runtime environment lives under `~/.stigmer/runtimes/agent-runner/<cli-version>/<platform>/`, self-contained per CLI version, with Python interpreter, virtual environment, cached wheels, and a manifest file all colocated. Runtime state (logs, PID files, workspace, artifacts) remains in the existing `~/.stigmer/data/` directory.

## Context

Agent-runner is migrating from a Docker container to a native OS process backed by a hermetic CPython runtime (python-build-standalone). This requires a well-defined filesystem layout for:

1. The CPython interpreter (downloaded from python-build-standalone releases)
2. A virtual environment containing all agent-runner dependencies
3. A cached wheelhouse for offline reinstall
4. Metadata for the Go CLI runtime manager to determine freshness

The layout must integrate with the existing `~/.stigmer/` directory structure without disrupting current components (stigmer-server, workflow-runner, Temporal, Ollama).

### Historical Path

| Date | Decision | Outcome |
|------|----------|---------|
| 2026-01-21 | PyInstaller standalone binary (DD-001 in `20260121.03`) | Failed — `multipart` dynamic imports broke at runtime |
| 2026-01-22 | Docker container fallback | Works, but requires Docker Desktop and mounts `$HOME` |
| 2026-03-01 | Hermetic CPython + venv (this project) | Eliminates Docker while preserving real CPython import semantics |

### Existing `~/.stigmer/` Layout

```
~/.stigmer/
├── config.yaml           # CLI configuration
├── stigmer.db            # SQLite database
├── data/                 # Runtime state (GetDataDir())
│   ├── bin/              # Extracted binaries (currently dormant for agent-runner)
│   ├── logs/             # Component log files
│   ├── daemon.pid        # stigmer-server PID
│   ├── workflow-runner.pid
│   ├── agent-runner-container.id
│   ├── workspace/        # Agent workspace
│   ├── artifacts/        # Shared artifacts
│   └── startup-config.json
├── bin/                  # Temporal binary
├── logs/                 # Temporal/Ollama logs
├── temporal-data/
├── temporal.pid
├── temporal.lock
└── llm.pid
```

Source: `config.ConfigDir = ".stigmer"`, `config.DefaultDataDir = "data"` in `client-apps/cli/internal/cli/config/config.go`.

Note: Temporal and Ollama put files directly under `~/.stigmer/` while daemon components use `~/.stigmer/data/`. This inconsistency predates this project and is not addressed here.

## Design

### Directory Structure

```
~/.stigmer/
├── data/                                # (existing) runtime state — unchanged
│   ├── logs/
│   │   └── agent-runner.log             # (existing in Docker mode; same path in native mode)
│   ├── agent-runner.pid                 # (NEW) native mode PID file
│   ├── agent-runner-container.id        # (existing) Docker fallback
│   ├── workspace/                       # (existing) agent workspace
│   └── artifacts/                       # (existing) shared artifacts
├── runtimes/                            # (NEW) runtime environments
│   └── agent-runner/
│       └── <cli-version>/               # e.g., 0.42.0
│           └── <platform>/              # e.g., darwin-arm64
│               ├── python/              # python-build-standalone extracted
│               │   ├── bin/
│               │   │   ├── python3
│               │   │   └── python3.11
│               │   ├── lib/
│               │   └── ...
│               ├── venv/                # virtual environment with all dependencies
│               │   ├── bin/
│               │   │   ├── python -> ../../python/bin/python3.11
│               │   │   └── activate
│               │   ├── lib/
│               │   │   └── python3.11/
│               │   │       └── site-packages/
│               │   └── pyvenv.cfg
│               ├── wheels/              # cached wheelhouse for reinstall
│               │   ├── temporalio-1.9.0-cp311-*.whl
│               │   ├── grpcio-*.whl
│               │   └── ...
│               └── manifest.json        # environment metadata
```

### Placement Rationale

`runtimes/` is a peer of `data/` under `~/.stigmer/`:

- **`runtimes/`** contains *tools* — immutable installations of interpreters and dependency environments. Analogous to `/usr/local/` in Unix.
- **`data/`** contains *state* — mutable runtime output like logs, PID files, workspace contents, and artifacts. Analogous to `/var/` in Unix.

This separation means `runtimes/` can be deleted entirely without losing any user data or configuration, and `data/` can be wiped without requiring a re-bootstrap of the runtime.

### Version Key: CLI Build Version

The directory key `<cli-version>` is the CLI's build version, the same value returned by `embedded.GetBuildVersion()` (injected via ldflags at build time).

Why the CLI version rather than the agent-runner app version or Python version:

- The CLI is the orchestrator — it decides which python-build-standalone release to download, which wheelhouse to install, and which agent-runner source to run.
- One CLI version deterministically produces one complete environment. There is no ambiguity.
- The Go code already has `embedded.GetBuildVersion()` available everywhere — no new plumbing needed.
- Upgrade detection is trivial: if `manifest.cli_version != embedded.GetBuildVersion()`, bootstrap a new environment.

When the CLI version is `dev` (local development builds), the runtime manager should still function — it bootstraps into `runtimes/agent-runner/dev/<platform>/`. Developers can force a re-bootstrap by deleting this directory.

### Platform Identifiers

Format: `GOOS-GOARCH` (lowercase, hyphen-separated).

| Identifier | OS | Architecture |
|------------|-----|-------------|
| `darwin-arm64` | macOS | Apple Silicon |
| `darwin-amd64` | macOS | Intel |
| `linux-amd64` | Linux | x86_64 |
| `linux-arm64` | Linux | aarch64 |

Constructed in Go as `runtime.GOOS + "-" + runtime.GOARCH`. This is the natural convention for a Go CLI and avoids inventing a custom scheme.

### manifest.json

Machine-readable metadata placed at the root of each platform directory:

```json
{
  "schema_version": 1,
  "cli_version": "0.42.0",
  "platform": "darwin-arm64",
  "python_version": "3.11.11",
  "python_build_standalone_tag": "20260115",
  "deps_lock_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "installed_at": "2026-03-01T05:00:00Z",
  "bootstrap_duration_ms": 12500
}
```

| Field | Purpose |
|-------|---------|
| `schema_version` | Forward compatibility — allows the format to evolve without breaking older CLIs |
| `cli_version` | Primary freshness check: must match `embedded.GetBuildVersion()` |
| `platform` | Redundant with path, but useful for validation and portability checks |
| `python_version` | Records the exact CPython version for diagnostics |
| `python_build_standalone_tag` | The GitHub release tag used, for reproducibility |
| `deps_lock_sha256` | Hash of the dependency lock file used to build the wheelhouse |
| `installed_at` | ISO 8601 timestamp of when the environment was created |
| `bootstrap_duration_ms` | How long the bootstrap took, useful for performance monitoring |

The Go runtime manager (T01.2) reads `manifest.json` on startup. If the file is missing, corrupt, or `cli_version` does not match the running CLI, a full bootstrap is triggered.

### Lifecycle Operations

| Operation | Behavior |
|-----------|----------|
| **First run** | Create `runtimes/agent-runner/<version>/<platform>/`, download Python, create venv, install wheels, write manifest |
| **Same version restart** | Read manifest, verify `cli_version` matches, skip bootstrap |
| **CLI upgrade** | New version directory created alongside old one; old one is not deleted |
| **Reinstall** | Delete `venv/`, recreate from `wheels/` without re-downloading |
| **Full reset** | `rm -rf runtimes/agent-runner/<version>/` removes everything for that version |
| **Cleanup stale versions** | Future `stigmer runtime cleanup` command deletes all version directories except the current one |

### Disk Budget

| Component | Estimated Size |
|-----------|---------------|
| python-build-standalone (extracted) | ~50 MB |
| venv (site-packages) | ~200 MB |
| wheels (cached) | ~100 MB |
| **Total per version** | **~350 MB** |

With old versions retained until cleanup, a user who upgrades once will have ~700 MB in `runtimes/`. This is acceptable for a development tool (comparable to a single `node_modules/` directory) and is managed by explicit cleanup.

## Alternatives Considered

### A. Runtime and application environments separated (Rejected)

```
~/.stigmer/runtimes/cpython/3.11.11/<platform>/python/
~/.stigmer/envs/agent-runner/<version>/<platform>/venv/
```

Separating the CPython runtime from the application venv would allow sharing one Python install across multiple components. Rejected because:

- Agent-runner is currently the only Python component, so sharing is premature.
- Splitting creates a coordination problem: which versions of which environments are compatible with which Python installs?
- If Python MCP servers later need their own runtime, we can revisit — adding a new key under `runtimes/` is backward-compatible.

### B. No platform directory level (Rejected)

```
~/.stigmer/runtimes/agent-runner/<version>/python/
```

Since a user's home directory is not shared across platforms, the `<platform>/` level is technically redundant on the user's machine. Rejected because:

- The Go code can construct the path deterministically from `runtime.GOOS` and `runtime.GOARCH` without reading any files.
- It mirrors the CI build matrix structure (T01.3 will produce artifacts keyed by platform).
- It provides a safety net if a user copies their `~/.stigmer/` directory to a different architecture.
- The cost is one extra directory level — negligible.

### C. Content-addressable wheelhouse cache (Rejected)

```
~/.stigmer/cache/wheels/<lockHash>/<platform>/
```

Keying the wheelhouse by the SHA-256 of the lock file would deduplicate wheels across CLI versions that share the same dependencies. Rejected because:

- The lock file is already pinned by the CLI version, so deduplication across versions is rare.
- Hash-based paths are opaque and harder to debug than version-based paths.
- Splitting the wheelhouse from the runtime directory complicates cleanup.
- The disk savings from deduplication do not justify the added complexity.

### D. No version directory — single mutable runtime (Rejected)

```
~/.stigmer/runtimes/agent-runner/<platform>/
```

Always overwriting a single runtime directory is simpler but eliminates atomic upgrades and rollback. Rejected because:

- Upgrading requires tearing down the old environment before building the new one, causing downtime if the bootstrap fails.
- No rollback path if a new version introduces a dependency issue.
- The per-version approach costs ~350 MB of additional disk per retained version — an acceptable trade-off for reliability.

## Consequences

### What Changes

- A new `runtimes/` directory appears under `~/.stigmer/` on first native agent-runner bootstrap.
- `agent-runner.pid` is added to `~/.stigmer/data/` for native mode (alongside the existing `agent-runner-container.id` for Docker mode).
- `stigmer server reset` (T01.4 or later) will need to be aware of `runtimes/` for full cleanup.

### What Does Not Change

- All existing paths under `~/.stigmer/data/` remain unchanged.
- Log rotation, PID management, and workspace handling continue using existing patterns.
- The Temporal and Ollama path inconsistencies (files in `~/.stigmer/` root vs `~/.stigmer/data/`) are not addressed — that is separate tech debt.
- The naming mismatch between `daemon.go` (`agent-runner-container.id`) and `supervisor.go` (`agent-runner.containerid`) is noted but not fixed here.

## References

- Research report: `_projects/2026-03/20260301.050000.research.eliminate-docker-for-agent-runner/04.report.gpt.md`
- Phase 1 plan: `_projects/2026-03/20260301.02.native-agent-runner/tasks/T01_0_plan.md`
- Prior DD on PyInstaller: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/design-decisions/001-pyinstaller-over-docker.md`
- Docker migration changelog: `_changelog/2026-01/2026-01-22-020000-migrate-agent-runner-to-docker.md`
- Config paths: `client-apps/cli/internal/cli/config/config.go`
- Version handling: `client-apps/cli/embedded/version.go`
