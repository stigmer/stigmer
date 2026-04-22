# Next Task: 20260422.01.runner-ux-cli-restructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260422.01.runner-ux-cli-restructure

**Description**: Restructure Stigmer CLI with `stigmer up`/`stigmer down` commands, implement standalone runner lifecycle (`stigmer up runner`), multi-runner management, context-aware smart defaults (local vs cloud), and web UI runner integration.
**Goal**: Give users a clean, intuitive way to manage the Stigmer control plane and runners independently, with smart defaults that adapt to local vs cloud context. Replace `stigmer server` with `stigmer up`/`stigmer down`. Enable cloud users to register their local machine as a runner.
**Tech Stack**: Go (CLI/Cobra), Python (agent-runner), TypeScript/React (web UI), Protobuf
**Components**: client-apps/cli (command structure, daemon, runner lifecycle); sdk/react (runner hooks, session composer); client-apps/web (runner picker, settings page); backend/services/stigmer-server (dispatch enhancement)

## Current State
- **Status**: T02 complete, ready for T03
- **Last Session**: 2026-04-22 — T02 implemented and committed (d375a5d1a)
- **Active Task**: T03 — `stigmer up` / `stigmer down` Commands

## Session Progress (2026-04-22)
- Reviewed T01 architectural plan — approved
- Confirmed workflow-runner excluded in server-only mode (both runners omitted, not just agent-runner)
- Implemented T02: Daemon Refactoring — Server-Only Mode
  - Added `ServerOnly bool` to `StartOptions`, `StartupConfig`
  - Made Python runtime bootstrap conditional on `!ServerOnly`
  - Added `STIGMER_SERVER_ONLY` env var propagation to internal-daemon
  - Refactored `buildComponents()` to filter by `serverOnly` flag
- All tests pass, full CLI binary compiles cleanly
- Committed: `d375a5d1a refactor(cli/daemon): add server-only mode to daemon lifecycle`

## Task Overview (8 tasks)

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T02 | Daemon Refactoring — Server-Only Mode | **Complete** | None |
| T03 | `stigmer up` / `stigmer down` Commands | Pending | T02 |
| T04 | Runner Lifecycle — `stigmer up runner` | Pending | T02, T03 |
| T05 | Multi-Runner Management | Pending | T04 |
| T06 | Embedded Runner Identity in `stigmer up` | Pending | T04, T05 |
| T07 | Dispatch Enhancement — Fail Fast Without Runner | Pending | T06 |
| T08 | Web UI — Runner Picker in Session Composer | Pending | T04 |
| T09 | Web UI — Settings > Runners Page | Pending | T08 |

## Next Steps
1. **Start T03** — Create `stigmer up` / `stigmer down` commands with `server` and `runner` subcommands
2. Implement smart default logic (no subcommand = server+runner if no cloud auth, runner-only if cloud auth)
3. Migrate `stigmer server status`, `stigmer server logs`, `stigmer server setup`, `stigmer server llm`, `stigmer server reset` to top-level commands
4. Deprecate `stigmer server` with alias and deprecation notice

## Key Architectural Decisions

1. `stigmer up` (no subcommand) = smart default: server+runner (no cloud) or runner-only (cloud)
2. `stigmer up server` = control plane only (Temporal + stigmer-server)
3. `stigmer up runner` = standalone agent-runner with backend auto-detection
4. Multiple runners per machine tracked in `~/.stigmer/runners/*.json`
5. Resource commands (`stigmer list runner`, etc.) handle runner CRUD
6. OSS: runner has LLM keys directly. Cloud: runner is credential-free (proxy).
7. Every agent-runner gets a Runner resource with identity and heartbeat
8. Workflow-runner excluded; custom images deferred

## Key Files

### CLI (current codebase to modify)
- `client-apps/cli/cmd/stigmer/root.go` — command registration
- `client-apps/cli/cmd/stigmer/root/server.go` — current `stigmer server` (to deprecate)
- `client-apps/cli/internal/cli/daemon/daemon.go` — daemon start logic (T02 complete: `ServerOnly` added)
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — `buildComponents()` (T02 complete: `serverOnly` filter)
- `client-apps/cli/embedded/agentrunner/` — Python source embedding
- `client-apps/cli/internal/cli/daemon/runner_native.go` — native runner bootstrap

### Proto (existing, no changes needed)
- `apis/ai/stigmer/agentic/runner/v1/` — Runner resource (api, spec, command, query, io, enum)

### Backend (minor changes)
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go` — dispatch enhancement

### Web / SDK (to create/modify)
- `sdk/react/src/composer/SessionComposer.tsx` — needs runner picker
- `sdk/react/src/session/useCreateSession.ts` — needs runnerId passthrough
- `sdk/typescript/src/gen/runner.ts` — RunnerClient (already exists)

## Context for Resume
- The "Runner as a Resource" project (Phase 0-2) is code complete (Sessions 1-18 of 20260420.01)
- Runner proto, backend handlers, SDK client, heartbeat, dispatch, launcher all exist
- The agent-runner Python process supports STIGMER_RUNNER_ID and heartbeat via HeartbeatEmitter
- The TypeScript SDK has RunnerClient and SessionInput.runnerId but they are unused by the React layer
- Phase 0 deploy (proxy, HTTPRoute) is pending — needed before cloud runner mode testing
- T02 is committed on `feat/secrets-vault-migration` branch (may need cherry-pick or rebase to project branch)

## Blockers
- None for T03-T06 (all local/OSS work)
- T08-T09 (web UI) can proceed independently of Phase 0 deploy
- Cloud runner testing blocked on Phase 0 deploy (proxy must be live)

## Quick Commands
- "Start T03" — Begin `stigmer up` / `stigmer down` commands
- "Show project status" — Overview of progress
- "Review T01 plan" — Read T01_0_plan.md

---

*This file provides direct paths to all project resources for quick context loading.*
