# Next Task: 20260422.01.runner-ux-cli-restructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260422.01.runner-ux-cli-restructure

**Description**: Restructure Stigmer CLI with `stigmer up`/`stigmer down` commands, implement standalone runner lifecycle (`stigmer up runner`), multi-runner management, context-aware smart defaults (local vs cloud), and web UI runner integration.
**Goal**: Give users a clean, intuitive way to manage the Stigmer control plane and runners independently, with smart defaults that adapt to local vs cloud context. Replace `stigmer server` with `stigmer up`/`stigmer down`. Enable cloud users to register their local machine as a runner.
**Tech Stack**: Go (CLI/Cobra), Python (agent-runner), TypeScript/React (web UI), Protobuf
**Components**: client-apps/cli (command structure, daemon, runner lifecycle); sdk/react (runner hooks, session composer); client-apps/web (runner picker, settings page); backend/services/stigmer-server (dispatch enhancement)

## Current State
- **Status**: T06 complete, ready for T07
- **Last Session**: 2026-04-22 — T06 implemented (embedded runner identity)
- **Active Task**: T07 — Dispatch Enhancement — Fail Fast Without Runner

## Session Progress (2026-04-22, Session 5)
- Implemented T06: Embedded Runner Identity in `stigmer up server`
  - `registerEmbeddedRunner()`: seedpack bootstrap + org discovery + Runner.Apply via raw gRPC proto clients, called between stigmer-server readiness and agent-runner start
  - `buildRunnerEnv()` now accepts `runnerID` and `taskQueue` params; sets `STIGMER_RUNNER_ID` and `STIGMER_TASK_QUEUE` env vars when provided, falls back to legacy hardcoded queue when empty
  - `buildComponents()` accepts `**embeddedRunnerIdentity` pointer; agent-runner closure dereferences at start time (after registration fills it)
  - `saveEmbeddedRunnerState()` / `removeEmbeddedRunnerState()`: write/delete `~/.stigmer/runners/embedded.json` directly (avoids circular dependency with runner package)
  - `ManagedByDaemon` field added to `runner.RunnerState` (`json:"managed_by_daemon,omitempty"`)
  - `StopRunner()` returns with guidance message when `ManagedByDaemon` is true
  - `StopAllRunners()` now filters out daemon-managed runners
- Discovered and solved ordering problem: seedpack bootstrap (which creates the org) had to move into daemon process, before Runner.Apply. Parent's seedpack call becomes idempotent no-op.
- Decision: embedded runner name is fixed "embedded" (not hostname-based)
- Decision: registration failure is hard failure (daemon startup aborts)
- All packages compile, `go vet ./client-apps/cli/...` clean
- No proto changes, no Python changes, no backend changes required

## Task Overview (8 tasks)

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T02 | Daemon Refactoring — Server-Only Mode | **Complete** | None |
| T03 | `stigmer up` / `stigmer down` Commands | **Complete (reworked in T04)** | T02 |
| T04 | Runner Lifecycle — `stigmer up runner` | **Complete** | T02, T03 |
| T05 | Multi-Runner Management | **Complete** | T04 |
| T06 | Embedded Runner Identity in `stigmer up` | **Complete** | T04, T05 |
| T07 | Dispatch Enhancement — Fail Fast Without Runner | Pending | T06 |
| T08 | Web UI — Runner Picker in Session Composer | Pending | T04 |
| T09 | Web UI — Settings > Runners Page | Pending | T08 |

## Next Steps
1. **Start T07** — Dispatch enhancement: fail fast without runner (OSS)
2. When `stigmer run` is executed but no runner is active, the OSS dispatch logic should fail fast with `FAILED_PRECONDITION` and a helpful message
3. Check for active runners (READY/BUSY phase) before scheduling the activity
4. File: `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go`

## Key Architectural Decisions

1. **Cloud-first**: `stigmer up` = start a runner (not a server). Cloud users are the primary audience.
2. `stigmer up server` = full local dev stack (Temporal + stigmer-server + embedded runner). OSS quickstart.
3. `stigmer up runner` = identical to `stigmer up` — explicit subcommand for clarity alongside `stigmer up server`
4. Credential resolution: `--token` flag > `STIGMER_API_KEY` env > config cloud token > decision tree (local probe / error with guidance)
5. Endpoint resolution: `--endpoint` flag > config endpoint > `api.stigmer.ai:443`
6. Multiple runners per machine tracked in `~/.stigmer/runners/*.json`
7. Resource commands (`stigmer list runner`, etc.) handle runner CRUD
8. OSS: runner has LLM keys directly. Cloud: runner is credential-free (proxy via `STIGMER_PROXY_ENDPOINT`).
9. Every agent-runner gets a Runner resource with identity and heartbeat
10. No auto-restart — foreground process, user sees exit. Deferred to runner-command-stream Go supervisor.
11. Workflow-runner excluded; custom images deferred
12. **Explicit naming**: no auto-suffix for multiple runners. Second `stigmer up` requires `--name` (T05 decision).
13. **Runner names are slugs**: `--name` serves as local key, server slug, and display name. Max 63 chars, lowercase alphanumeric + hyphens.
14. **Embedded runner identity**: daemon registers "embedded" Runner resource between server readiness and agent-runner start. Seedpack bootstrap moved into daemon to ensure org exists first. Registration failure is hard failure. (T06 decision)
15. **Daemon-managed state files**: daemon writes `~/.stigmer/runners/embedded.json` directly (circular dep avoidance). `ManagedByDaemon` flag prevents `stigmer down runner` from killing daemon-managed processes. (T06 decision)

## Key Files

### CLI (current state after T06)
- `client-apps/cli/cmd/stigmer/root.go` — command registration (Lifecycle group)
- `client-apps/cli/cmd/stigmer/root/up.go` — `stigmer up` (runner), `stigmer up server`, `stigmer up runner`
- `client-apps/cli/cmd/stigmer/root/up_start.go` — server startup orchestration (unchanged from T03)
- `client-apps/cli/cmd/stigmer/root/up_bootstrap.go` — post-startup bootstrap (unchanged)
- `client-apps/cli/cmd/stigmer/root/down.go` — `stigmer down` (server+runners), `stigmer down server`, `stigmer down runner`
- `client-apps/cli/cmd/stigmer/root/list.go` — `stigmer list runners` (local state files)
- `client-apps/cli/internal/cli/runner/backend_info.go` — credential + endpoint resolution
- `client-apps/cli/internal/cli/runner/runner_env.go` — Python process env builder
- `client-apps/cli/internal/cli/runner/state.go` — runner state persistence, stale reaping, listing, `ManagedByDaemon` field
- `client-apps/cli/internal/cli/runner/bootstrap.go` — Python runtime bootstrap
- `client-apps/cli/internal/cli/runner/start.go` — main runner orchestration, slug validation, conflict detection
- `client-apps/cli/internal/cli/runner/stop.go` — external runner stop, daemon-managed protection
- `client-apps/cli/internal/cli/runner/copydir.go` — directory copy helper
- `client-apps/cli/internal/cli/config/config.go` — `IsCloudMode()` added
- `client-apps/cli/internal/cli/daemon/daemon.go` — daemon start logic (T02: `ServerOnly`)
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — `buildComponents()`, `registerEmbeddedRunner()`, `buildRunnerEnv()`, embedded state management
- `client-apps/cli/internal/cli/types/registry.go` — runner in `cliRelevantKinds`
- `client-apps/cli/internal/cli/types/verb_support.go` — runner verb support (apply, get, list)

### Proto (existing, no changes needed)
- `apis/ai/stigmer/agentic/runner/v1/` — Runner resource (api, spec, command, query, io, enum)

### Backend (minor changes in T07)
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go` — dispatch enhancement

### Web / SDK (T08-T09)
- `sdk/react/src/composer/SessionComposer.tsx` — needs runner picker
- `sdk/react/src/session/useCreateSession.ts` — needs runnerId passthrough

## Context for Resume
- The "Runner as a Resource" project (Phase 0-2) is code complete (Sessions 1-18 of 20260420.01)
- Runner proto, backend handlers, SDK client, heartbeat, dispatch, launcher all exist
- The agent-runner Python process supports STIGMER_RUNNER_ID and heartbeat via HeartbeatEmitter
- The TypeScript SDK has RunnerClient and SessionInput.runnerId but they are unused by the React layer
- Phase 0 deploy (proxy, HTTPRoute) is pending — needed before cloud runner mode testing
- T02-T06 are on `feat/secrets-vault-migration` branch
- `stigmer up` is now a runner command (cloud-first), no longer starts a server
- `stigmer up server` starts the full local dev stack with embedded runner identity
- Runner command stream project (20260422.02) will replace Python heartbeat with Go supervisor + bidi gRPC stream — T04/T05/T06 are forward-compatible
- `ServerOnly` daemon mode (T02) still exists as internal capability, not user-facing
- Runner is now a CLI-visible resource kind in the type registry
- Embedded runner registered as first-class Runner resource with heartbeat (T06)
- Daemon manages embedded runner state file lifecycle (create on start, remove on shutdown)

## Blockers
- None for T07 (all local/OSS work)
- T08-T09 (web UI) can proceed independently of Phase 0 deploy
- Cloud runner testing blocked on Phase 0 deploy (proxy must be live)

## Quick Commands
- "Start T07" — Begin dispatch fail-fast enhancement
- "Show project status" — Overview of progress
- "Review T01 plan" — Read T01_0_plan.md

---

*This file provides direct paths to all project resources for quick context loading.*
