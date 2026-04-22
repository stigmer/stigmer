# Task T01: Project Plan — Runner UX & CLI Restructure

**Created**: 2026-04-22
**Status**: PENDING REVIEW
**Type**: Feature Development (architectural redesign + implementation)

## Objective

Restructure the Stigmer CLI around `stigmer up` / `stigmer down` with `server` and `runner` subcommands. Implement standalone runner lifecycle, multi-runner management, context-aware smart defaults, and web UI runner integration.

## Context

The "Runner as a Resource" project (Sessions 1-18) built the Runner proto, backend handlers, SDK client, heartbeat, dispatch, and launcher. But the Runner is invisible to users — there is no CLI command to start/stop a runner independently, and the web session composer has no runner picker. `stigmer server` bundles the control plane and agent-runner into a monolithic daemon with no separation.

This project completes the user-facing story: how users start runners, select them, and manage them.

## Architectural Decisions (from planning conversation)

1. `stigmer up` / `stigmer down` replaces `stigmer server` / `stigmer server stop`
2. `stigmer up` has two subcommands: `server` (control plane) and `runner` (agent-runner)
3. `stigmer up` (no subcommand) uses a smart default: server+runner if no cloud auth, runner-only if cloud auth
4. Runner resource management uses existing `stigmer list runner`, `stigmer get runner`, `stigmer delete runner`
5. Multiple runners per machine via unique names, tracked in `~/.stigmer/runners/`
6. OSS runner has LLM keys directly (no proxy); cloud runner is credential-free (proxy)
7. Every agent-runner process gets a Runner resource with identity and heartbeat
8. Workflow-runner excluded from this project (future concern)
9. Custom runner images deferred

## Task Breakdown

### T02: Daemon Refactoring — Server-Only Mode
**Estimated effort**: 1 session
**Dependencies**: None (foundation for all other tasks)

Split `buildComponents()` in `daemon_process.go` to support a `ServerOnly` mode that excludes the agent-runner from the component list. Add `ServerOnly bool` to `StartOptions` in `daemon.go`. When `ServerOnly` is true, only Temporal + stigmer-server are started (no agent-runner, no workflow-runner).

**Files**:
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — `buildComponents()` accepts `serverOnly`
- `client-apps/cli/internal/cli/daemon/daemon.go` — `StartOptions` gains `ServerOnly`

**Why first**: This is the foundation. Both `stigmer up server` and `stigmer up` (with separate runner) depend on the ability to start the control plane without the agent-runner.

---

### T03: `stigmer up` / `stigmer down` Commands
**Estimated effort**: 1-2 sessions
**Dependencies**: T02

Create the `up` and `down` top-level commands with `server` and `runner` subcommands. Implement the smart default logic (no subcommand = server+runner if no cloud auth, runner-only if cloud auth). Migrate `stigmer server status`, `stigmer server logs`, `stigmer server setup`, `stigmer server llm`, `stigmer server reset` to top-level commands. Deprecate `stigmer server` with alias and deprecation notice.

**Files to create**:
- `client-apps/cli/cmd/stigmer/root/up.go` — `stigmer up` with `server`/`runner` subcommands
- `client-apps/cli/cmd/stigmer/root/down.go` — `stigmer down` with `server`/`runner` subcommands
- `client-apps/cli/cmd/stigmer/root/status_cmd.go` — top-level `stigmer status`
- `client-apps/cli/cmd/stigmer/root/logs_cmd.go` — top-level `stigmer logs`
- `client-apps/cli/cmd/stigmer/root/setup_cmd.go` — top-level `stigmer setup`

**Files to modify**:
- `client-apps/cli/cmd/stigmer/root.go` — register new commands, deprecate `server` group
- `client-apps/cli/cmd/stigmer/root/server.go` — mark deprecated, forward to `up`

**Scope note**: The `stigmer up runner` subcommand is wired in this task but the actual runner start logic is implemented in T04. This task focuses on command structure, smart defaults, and server lifecycle.

---

### T04: Runner Lifecycle — `stigmer up runner` Implementation
**Estimated effort**: 2 sessions
**Dependencies**: T02, T03

Implement the core runner lifecycle: backend auto-detection (local vs cloud), Runner resource apply, Python runtime bootstrap, agent-runner process start, graceful shutdown with STOPPED heartbeat. This is the heart of the project.

**Files to create**:
- `client-apps/cli/internal/cli/runner/start.go` — runner start logic (apply, bootstrap, start process, foreground supervision)
- `client-apps/cli/internal/cli/runner/stop.go` — runner stop logic (SIGTERM, STOPPED heartbeat, PID cleanup)
- `client-apps/cli/internal/cli/runner/context.go` — backend auto-detection (cloud auth check, local server probe)
- `client-apps/cli/internal/cli/runner/identity.go` — `~/.stigmer/runners/*.json` read/write, identity persistence
- `client-apps/cli/internal/cli/runner/env.go` — environment wiring (local mode: LLM keys from config; cloud mode: proxy endpoint, JWT)

**Key reuse**:
- `embedded/agentrunner.SourceFS()` + `daemon.bootstrapRunnerRuntime()` for Python venv
- `backend.NewStigmerClient()` for gRPC apply and initial heartbeat call

**Behavior**:
- `stigmer up runner` runs in foreground (the CLI process IS the supervisor)
- Ctrl+C sends SIGTERM to Python process, waits for STOPPED heartbeat, cleans up PID file
- `stigmer up runner --name my-macbook` sets the runner slug
- `stigmer up runner --backend api.stigmer.ai` overrides auto-detection

---

### T05: Multi-Runner Management
**Estimated effort**: 1 session
**Dependencies**: T04

Implement multi-runner tracking in `~/.stigmer/runners/`. Each runner is a JSON file with `runner_id`, `slug`, `org`, `backend`, `pid`, `mode`, `started_at`. Handle name uniqueness (error if already running), default name from hostname with suffix, PID liveness checks. Implement `stigmer down runner` (stop all) and `stigmer down runner --name <name>` (stop specific).

**Files**:
- `client-apps/cli/internal/cli/runner/identity.go` — extended with multi-runner logic
- `client-apps/cli/internal/cli/runner/stop.go` — extended with name-based and all-runner stop

---

### T06: Embedded Runner Identity in `stigmer up`
**Estimated effort**: 1 session
**Dependencies**: T04, T05

When `stigmer up` (no subcommand, local mode) starts both server and runner, the embedded runner must be registered as a Runner resource. After stigmer-server readiness, call `RunnerCommandController.apply`, receive `runner_id` and `task_queue`, pass them to `buildRunnerEnv()`. Track the embedded runner in `~/.stigmer/runners/embedded.json`. `stigmer down` stops both runner and server.

**Files to modify**:
- `client-apps/cli/internal/cli/daemon/daemon.go` — after server readiness, apply Runner resource
- `client-apps/cli/internal/cli/daemon/daemon_process.go` — pass `STIGMER_RUNNER_ID` and `STIGMER_TASK_QUEUE` into `buildRunnerEnv()`

---

### T07: Dispatch Enhancement — Fail Fast Without Runner (OSS)
**Estimated effort**: 1 session
**Dependencies**: T06

When `stigmer run` is executed but no runner is active, the OSS dispatch logic should fail fast with `FAILED_PRECONDITION` and a helpful message instead of waiting for a Temporal StartToClose timeout. Check for active runners (READY/BUSY phase) before scheduling the activity.

**Files**:
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/dispatch.go` — add runner availability check
- Cloud equivalent (stigmer-cloud) can be done in parallel or follow-up

---

### T08: Web UI — Runner Picker in Session Composer
**Estimated effort**: 1-2 sessions
**Dependencies**: T04 (runners must be startable for testing)

Create `useListRunners` React hook in `sdk/react/`. Add runner picker dropdown to `SessionComposer` showing READY/BUSY user-created runners + "Cloud (auto)" default. Wire `runnerId` through `useCreateSession` into `SessionSpec`. The TypeScript SDK already supports `SessionInput.runnerId`; the React layer just needs to forward it.

**Files to create**:
- `sdk/react/src/runner/useListRunners.ts` — hook calling `stigmer.runner.list()`

**Files to modify**:
- `sdk/react/src/composer/SessionComposer.tsx` — add runner picker dropdown
- `sdk/react/src/session/useCreateSession.ts` — pass `runnerId`
- `client-apps/web/src/components/session/SessionLauncher.tsx` — wire runner selection

---

### T09: Web UI — Settings > Runners Page
**Estimated effort**: 1 session
**Dependencies**: T08

Admin page showing all runners in the org. List view with columns: Name, Phase, Machine, OS/Arch, Runner Version, Current Executions, Last Heartbeat. System-managed runners hidden by default (toggle to show). Actions: Delete stale runners.

**Files to create**:
- `client-apps/web/src/app/settings/runners/page.tsx`
- `client-apps/web/src/components/runner/RunnerList.tsx`

---

## Task Dependency Graph

```
T02 (Daemon Split)
 ├──> T03 (up/down Commands)
 │     └──> T04 (Runner Lifecycle)
 │           ├──> T05 (Multi-Runner)
 │           │     └──> T06 (Embedded Runner Identity)
 │           │           └──> T07 (Dispatch Fail-Fast)
 │           └──> T08 (Web Runner Picker)
 │                 └──> T09 (Settings Page)
```

T08 and T05 can proceed in parallel after T04 is done.

## Execution Order

1. **T02** — Daemon refactoring (foundation)
2. **T03** — `stigmer up` / `stigmer down` commands (CLI restructure)
3. **T04** — Runner lifecycle implementation (core feature)
4. **T05** — Multi-runner management (extends T04)
5. **T06** — Embedded runner identity (unifies model)
6. **T07** — Dispatch fail-fast (UX polish)
7. **T08** — Web runner picker (frontend)
8. **T09** — Settings > Runners page (frontend)

## Success Criteria

- [ ] `stigmer up` starts server + runner (local mode) or runner-only (cloud mode)
- [ ] `stigmer up server` starts only the control plane
- [ ] `stigmer up runner` starts a standalone runner connected to local or cloud
- [ ] `stigmer up runner --name foo --backend api.stigmer.ai` works
- [ ] Multiple runners per machine with unique names in `~/.stigmer/runners/`
- [ ] `stigmer down` stops everything
- [ ] `stigmer server` still works (deprecated alias)
- [ ] Runner picker visible in web session composer
- [ ] Settings > Runners page shows all runners in org
- [ ] Embedded runner has a Runner resource with heartbeat

## Notes

- Workflow-runner is excluded from all tasks (deferred)
- Custom runner images are deferred
- Cloud runner testing depends on Phase 0 proxy deployment (separate project)
- The `stigmer run` command is unchanged — it creates executions, not runners
