# Next Task: 20260422.01.runner-ux-cli-restructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260422.01.runner-ux-cli-restructure

**Description**: Restructure Stigmer CLI with `stigmer up`/`stigmer down` commands, implement standalone runner lifecycle (`stigmer up runner`), multi-runner management, context-aware smart defaults (local vs cloud), and web UI runner integration.
**Goal**: Give users a clean, intuitive way to manage the Stigmer control plane and runners independently, with smart defaults that adapt to local vs cloud context. Replace `stigmer server` with `stigmer up`/`stigmer down`. Enable cloud users to register their local machine as a runner.
**Tech Stack**: Go (CLI/Cobra), Python (agent-runner), TypeScript/React (web UI), Protobuf
**Components**: client-apps/cli (command structure, daemon, runner lifecycle); sdk/react (runner hooks, session composer); client-apps/web (runner picker, settings page); backend/services/stigmer-server (dispatch enhancement)

## Current State
- **Status**: T03 complete, ready for T04
- **Last Session**: 2026-04-22 — T03 implemented and committed
- **Active Task**: T04 — Runner Lifecycle (`stigmer up runner`)

## Session Progress (2026-04-22, Session 2)
- Planned T03 with thorough codebase exploration before writing any code
- Made key design decisions during planning:
  - Smart default uses `config.Backend.Type` (explicit user choice), not token probing
  - `stigmer server` deleted entirely — no deprecation, no aliases (no users yet)
  - `stigmer server llm` deleted with no replacement (Ollama removal is a separate task)
  - `stigmer mcp-server` stays as top-level command (different lifecycle model)
- Implemented T03: `stigmer up` / `stigmer down` Commands
  - Created `up.go`, `up_start.go`, `up_bootstrap.go` — up command + startup orchestration
  - Created `down.go` — down command with server/runner subcommands
  - Created `status_cmd.go`, `status_health.go` — top-level `stigmer status`
  - Created `logs_cmd.go`, `logs_stream.go` — top-level `stigmer logs`
  - Created `setup_cmd.go` — top-level `stigmer setup`
  - Created `reset_cmd.go` — top-level `stigmer reset`
  - Deleted 7 server_*.go files + docs/server.mdx
  - Updated root.go: new "Lifecycle" command group, removed `NewServerCommand()`
  - Added `IsCloudMode()` to config package
  - Updated test file references
- All tests pass, full CLI binary compiles cleanly
- Gazelle BUILD.bazel regenerated

## Task Overview (8 tasks)

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T02 | Daemon Refactoring — Server-Only Mode | **Complete** | None |
| T03 | `stigmer up` / `stigmer down` Commands | **Complete** | T02 |
| T04 | Runner Lifecycle — `stigmer up runner` | Pending | T02, T03 |
| T05 | Multi-Runner Management | Pending | T04 |
| T06 | Embedded Runner Identity in `stigmer up` | Pending | T04, T05 |
| T07 | Dispatch Enhancement — Fail Fast Without Runner | Pending | T06 |
| T08 | Web UI — Runner Picker in Session Composer | Pending | T04 |
| T09 | Web UI — Settings > Runners Page | Pending | T08 |

## Next Steps
1. **Start T04** — Implement runner lifecycle (`stigmer up runner`)
2. Backend auto-detection (local server probe vs cloud auth check)
3. Runner resource apply (create Runner via gRPC)
4. Python runtime bootstrap reuse outside daemon context
5. Foreground supervision with SIGTERM/STOPPED heartbeat

## Key Architectural Decisions

1. `stigmer up` (no subcommand) = smart default: server+runner (local) or informative message (cloud)
2. `stigmer up server` = control plane only (Temporal + stigmer-server) — uses T02 `ServerOnly` mode
3. `stigmer up runner` = standalone agent-runner with backend auto-detection (T04)
4. Smart default discriminator: `config.Backend.Type` (explicit user choice, not token probing)
5. Multiple runners per machine tracked in `~/.stigmer/runners/*.json`
6. Resource commands (`stigmer list runner`, etc.) handle runner CRUD
7. OSS: runner has LLM keys directly. Cloud: runner is credential-free (proxy).
8. Every agent-runner gets a Runner resource with identity and heartbeat
9. Workflow-runner excluded; custom images deferred

## Key Files

### CLI (current state after T03)
- `client-apps/cli/cmd/stigmer/root.go` — command registration (Lifecycle group added)
- `client-apps/cli/cmd/stigmer/root/up.go` — `stigmer up` command definitions
- `client-apps/cli/cmd/stigmer/root/up_start.go` — startup orchestration (startServerFresh, displayLLMStatus, reportDegradedComponents)
- `client-apps/cli/cmd/stigmer/root/up_bootstrap.go` — post-startup bootstrap (autoSetOrgContext, runBootstrapDiscovery)
- `client-apps/cli/cmd/stigmer/root/down.go` — `stigmer down` command
- `client-apps/cli/cmd/stigmer/root/status_cmd.go` — `stigmer status` + display helpers
- `client-apps/cli/cmd/stigmer/root/status_health.go` — health probe helpers
- `client-apps/cli/cmd/stigmer/root/logs_cmd.go` — `stigmer logs` command
- `client-apps/cli/cmd/stigmer/root/logs_stream.go` — log streaming helpers
- `client-apps/cli/cmd/stigmer/root/setup_cmd.go` — `stigmer setup` command
- `client-apps/cli/cmd/stigmer/root/reset_cmd.go` — `stigmer reset` command
- `client-apps/cli/internal/cli/config/config.go` — `IsCloudMode()` added
- `client-apps/cli/internal/cli/daemon/daemon.go` — daemon start logic (T02: `ServerOnly`)
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — `buildComponents()` (T02: `serverOnly` filter)

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
- T02 and T03 are committed on `feat/secrets-vault-migration` branch
- `stigmer server` command no longer exists — fully replaced by `stigmer up`/`stigmer down`
- `stigmer up runner` subcommand is wired but prints placeholder message (T04 implements it)

## Blockers
- None for T04-T06 (all local/OSS work)
- T08-T09 (web UI) can proceed independently of Phase 0 deploy
- Cloud runner testing blocked on Phase 0 deploy (proxy must be live)

## Quick Commands
- "Start T04" — Begin runner lifecycle implementation
- "Show project status" — Overview of progress
- "Review T01 plan" — Read T01_0_plan.md

---

*This file provides direct paths to all project resources for quick context loading.*
