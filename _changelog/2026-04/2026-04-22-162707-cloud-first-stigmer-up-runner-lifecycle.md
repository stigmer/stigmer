# Cloud-First `stigmer up` and Runner Lifecycle

**Date**: April 22, 2026

## Summary

Restructured `stigmer up` to be a cloud-first runner command and implemented the complete standalone runner lifecycle. Cloud users (the primary audience) can now start a runner with `stigmer up`, while OSS users start the full local stack with `stigmer up server`. The runner package handles backend resolution, gRPC registration, Python bootstrap, foreground supervision, and graceful shutdown.

## Problem Statement

The CLI's `stigmer up` command started the entire local stack (Temporal + server + runner) and had no cloud mode support. Cloud users — the paying customers — had no way to register their local machine as a runner connected to Stigmer Cloud. The command model was OSS-first, treating cloud as an afterthought.

### Pain Points

- `stigmer up` started a server — but cloud users don't need a local server
- No way to start a standalone runner connected to cloud (or any external backend)
- No `--endpoint` / `--token` flags for portable execution (CI/CD, containers, sandboxes)
- `stigmer up server` was "server-only mode" — confusing naming for what should be "local dev stack"
- Runner lifecycle (register, start, supervise, shutdown) had no implementation

## Solution

Inverted the command model: `stigmer up` is now a runner command. The full local stack is explicitly `stigmer up server`. A new `runner` package implements the complete lifecycle with parameterized dependencies and forward-compatible design.

## Implementation Details

### Command Model Change (T03 Rework)

| Command | Before | After |
|---------|--------|-------|
| `stigmer up` | Start server+runner (local only) | Start a runner (cloud-first) |
| `stigmer up server` | Server only (`ServerOnly=true`) | Full local stack (`ServerOnly=false`) |
| `stigmer up runner` | Placeholder | Identical to `stigmer up` |

New flags on `stigmer up` / `stigmer up runner`: `--endpoint`, `--token`, `--name`.

Sandbox/execution flags moved to `stigmer up server` where they belong.

### Backend Resolution Decision Tree

The runner resolves its backend through a strict priority chain with no smart defaults:

1. Token: `--token` flag > `STIGMER_API_KEY` env > config cloud token
2. Endpoint: `--endpoint` flag > config endpoint > `api.stigmer.ai:443`
3. If no token and local config: TCP probe to server, error if unreachable
4. If no token and cloud/no config: error with guidance (auth login, flags, or `up server`)

### Runner Package (`client-apps/cli/internal/cli/runner/`)

Seven files, each with a single responsibility:

- **`backend_info.go`** — Credential + endpoint resolution implementing the decision tree
- **`runner_env.go`** — Builds environment variables for the Python process. Fully parameterized (no `os.Getenv` reads), making it deterministic and testable.
- **`state.go`** — Persists runner state to `~/.stigmer/runners/<name>.json`. Supports save, load, remove, PID liveness checks, and listing active runners.
- **`bootstrap.go`** — Python runtime bootstrap reusing `pythonrt.Manager` (same underlying primitive as the daemon's bootstrap)
- **`start.go`** — Main orchestration: resolve name → check active → resolve backend → gRPC client → Apply runner → bootstrap Python → build env → start process → signal handler → graceful shutdown → STOPPED heartbeat → cleanup
- **`stop.go`** — External stop via `stigmer down runner`: SIGTERM → wait 5s → SIGKILL → cleanup
- **`copydir.go`** — Directory copy helper for dev-mode pre-install hook

### Forward Compatibility

Designed to be cleanly replaced by the runner-command-stream project:
- Heartbeat: passes `STIGMER_RUNNER_ID` to Python's `HeartbeatEmitter`. When bidi stream lands, Go supervisor takes over. The env var becomes unnecessary.
- Task queue: uses `task_queue` from Apply response. Falls back to `agent_execution_runner` if not set. Forward-compatible with per-runner dispatch.
- No auto-restart: foreground process. Auto-restart belongs in the Go supervisor model.

## Benefits

- **Cloud users can register runners**: `stigmer up --token sk-...` from any machine
- **Portable execution**: `--endpoint` and `--token` work without config files (CI/CD, Docker containers, sandboxes)
- **Clear command hierarchy**: `up` = runner (90% of users), `up server` = local dev (explicit opt-in)
- **Clean separation**: runner package is fully parameterized with no global state
- **Forward-compatible**: designed to be smoothly replaced by the bidi stream supervisor

## Impact

- **Cloud users**: Can now start runners connected to Stigmer Cloud
- **OSS users**: `stigmer up server` replaces the old `stigmer up` for local development
- **CLI architecture**: New `runner` package establishes patterns for runner lifecycle management
- **Command UX**: `stigmer up` behavior fundamentally changed — cloud-first instead of local-first

## Related Work

- T02: Daemon server-only mode (foundation for independent runner start)
- T03: Original `stigmer up`/`stigmer down` restructure (reworked in this session)
- Runner as a Resource project (20260420.01): Proto, backend handlers, SDK client, heartbeat
- Runner command stream project (20260422.02): Will replace Python heartbeat with Go supervisor + bidi gRPC stream

---

**Status**: Production Ready
**Timeline**: 1 session (T03 rework + T04 implementation)
