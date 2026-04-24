# Replace `stigmer server` with `stigmer up` / `stigmer down` Commands

**Date**: April 22, 2026

## Summary

Replaced the monolithic `stigmer server` command group with a new `stigmer up` / `stigmer down` lifecycle model. All server management commands (`status`, `logs`, `setup`, `reset`) are now top-level commands under a new "Lifecycle" group. The `stigmer server` command and all its subcommands have been completely removed.

## Problem Statement

The `stigmer server` command bundled the entire Stigmer stack (Temporal, stigmer-server, workflow-runner, agent-runner) into a single undifferentiated start/stop. There was no way to start the control plane independently from runners, which is a prerequisite for the standalone runner model where users can register their local machine as a runner connected to either a local or cloud backend.

### Pain Points

- `stigmer server` starts everything or nothing — no granularity
- No path for cloud users to start just a runner without the control plane
- Server subcommands (`stigmer server status`, `stigmer server logs`) are unnecessarily nested
- The command namespace doesn't communicate the lifecycle intent (`up`/`down` vs `server`/`server stop`)

## Solution

Introduced a clean lifecycle command model inspired by tools like Docker Compose:

- `stigmer up` — smart default based on `config.Backend.Type` (local = full stack, cloud = informative message)
- `stigmer up server` — control plane only (uses T02's `ServerOnly` daemon mode)
- `stigmer up runner` — standalone runner (placeholder, implemented in T04)
- `stigmer down` / `stigmer down server` / `stigmer down runner` — corresponding stop commands
- `stigmer status`, `stigmer logs`, `stigmer setup`, `stigmer reset` — promoted to top-level

## Implementation Details

### New files created (9 files in `client-apps/cli/cmd/stigmer/root/`)

| File | Purpose |
|------|---------|
| `up.go` | Command definitions: `stigmer up`, `stigmer up server`, `stigmer up runner` |
| `up_start.go` | Startup orchestration: `prepareAndStartServer()`, `startServerFresh()`, LLM status display |
| `up_bootstrap.go` | Post-startup bootstrap: org context auto-detection, MCP discovery |
| `down.go` | Stop commands with server/runner subcommands |
| `status_cmd.go` | Top-level `stigmer status` with component health display |
| `status_health.go` | Health probe helpers (PID checks, TCP probes, state display) |
| `logs_cmd.go` | Top-level `stigmer logs` with component filtering |
| `logs_stream.go` | Real-time log streaming with inode-based file replacement detection |
| `setup_cmd.go` | Top-level `stigmer setup` (interactive LLM provider wizard) |
| `reset_cmd.go` | Top-level `stigmer reset` (destructive environment wipe + restart) |

### Files deleted (8 files)

All `server*.go` files and `docs/server.mdx` — the entire `stigmer server` command group.

### Key design decisions

- **Smart default discriminator**: Uses `config.Backend.Type` (the user's explicit `local`/`cloud` choice via `stigmer config backend set`), not token probing. This is predictable, debuggable, and not susceptible to env var surprises.
- **No deprecation**: `stigmer server` was deleted entirely — no aliases, no deprecation warnings. The platform has no external users yet, so a clean break is preferred over carrying compatibility debt.
- **File organization**: Follows the 250-line-per-file coding guideline. `up.go` was split into three files (commands, startup orchestration, bootstrap) to stay under the limit while keeping related code colocated.

## Benefits

- Users get a clear mental model: `up` starts things, `down` stops things
- The control plane and runners can be managed independently
- Top-level commands (`stigmer status`, `stigmer logs`) are more discoverable
- The command structure is ready for T04 (standalone runner lifecycle)
- No dead code or deprecation warnings to maintain

## Impact

- **CLI users**: All `stigmer server *` commands are replaced by their top-level equivalents
- **Documentation**: `docs/server.mdx` removed; new command docs needed
- **Tests**: `output_format_test.go` updated to reference new command constructors and handlers
- **Build**: BUILD.bazel regenerated via gazelle

## Related Work

- T02: Daemon server-only mode (prerequisite — enables `stigmer up server`)
- T04: Runner lifecycle implementation (next — fills in `stigmer up runner`)
- Separate task: Ollama removal (will simplify `addLLMSections` in `status_cmd.go`)

---

**Status**: Production Ready
**Timeline**: 1 session
