# Task T01: Phase 3 — Persistent Runners + Browser Launch — Design & Task Plan

**Created**: 2026-04-23
**Status**: PENDING REVIEW
**Type**: Feature Development

## Objective

Enable cloud users to launch a local runner from the browser, manage runners with full CRUD in the Settings UI, and optionally run agents inside Docker containers on their laptop. The centrepiece is the `stigmer://` URL scheme flow: browser → OS → CLI → runner starts → appears in cloud console.

## What already exists (built in prior projects)

From **20260420.01.agent-runner-as-resource** (Phases 0–2):
- AgentRunner proto, Java aggregate, Go controller, heartbeat, idle watchdog, dispatch
- RunnerLauncher abstraction (DaytonaSandboxRunnerLauncher, NoopRunnerLauncher)
- Runner auth via `STIGMER_TOKEN` (single-channel, no impersonation)
- Side-Channel Proxy code complete (pending deploy — not a blocker for this project)

From **20260422.01.runner-ux-cli-restructure**:
- `stigmer up runner` CLI command with multi-runner management
- Runner picker in session composer (`RunnerPicker.tsx`)
- Settings > Runners page (read-only `RunnerListPanel.tsx`)
- Session auto-bind and dispatch routing to chosen runner
- Runner state persistence in `~/.stigmer/runners/*.json`

From **20260422.02.runner-command-stream**:
- Bidirectional gRPC stream from runner to server
- `sendCommand` API (Go + Java) for pushing commands to runners
- T08 integration testing still pending

## The user experience (what we're building)

### Launch Local Runner from browser

1. User opens **Settings > Runners** in cloud console
2. Clicks **"Launch Local Runner"** button
3. Console calls `POST /v1/agent-runners/launch-tokens` → gets a one-time token
4. Console navigates to `stigmer://launch-runner?token=<jwt>&runtime=cli-daemon`
5. OS dispatches URL to the registered Stigmer CLI handler
6. CLI exchanges token → gets long-lived `STIGMER_TOKEN`
7. CLI creates AgentRunner resource via `apply`, spawns agent-runner, starts heartbeating
8. Console polls until the new runner appears as **Ready**
9. User can now select it in the session composer and route executions to their laptop

### Fallback: CLI not installed

If the browser opens `stigmer://...` and nothing handles it:
- After a 3-second timeout, the console shows a **"Stigmer CLI not installed"** dialog
- Dialog provides platform-specific install instructions and download links
- Same pattern Zoom/Slack/Figma use

### Stop a runner from the UI

1. User clicks **Stop** on a runner row in Settings > Runners
2. Console calls `sendCommand(Shutdown)` via the runner command stream API
3. Runner receives Shutdown, triggers graceful exit (SIGTERM to self → final STOPPED heartbeat → Temporal drain)
4. UI updates runner status to Stopped
5. For cloud runners: `DeprovisionInfrastructureStep` fires on STOPPED heartbeat (already exists)

### Docker placement

User runs `stigmer up runner --runtime docker` (or the browser flow specifies `runtime=docker`):
- CLI runs `docker run stigmer/agent-runner:<version>` with STIGMER_TOKEN and endpoint env vars
- Optional volume mounts for workspace access
- `stigmer down runner <name>` does `docker stop` + `docker rm`

## Task Breakdown

### T02: Server-Side Launch Token Endpoints (Java, stigmer-cloud)

**Goal**: Secure browser-to-CLI handshake via one-time tokens.

**New endpoints in stigmer-service:**
- `POST /v1/agent-runners/launch-tokens` — authenticated (user JWT). Returns `{ token, expiresAt }`. Token is a short-lived JWT (TTL 60s, single-use) containing claims: `sub` (user ID), `org_id`, `runtime` (cli-daemon|docker), `runner_name` (optional).
- `POST /v1/agent-runners/exchange-launch-token` — **unauthenticated** (the CLI doesn't have credentials yet). Accepts the one-time token, validates (not expired, not consumed), returns `{ stigmerToken, endpoint, runnerId }`. Marks the token as consumed.

**Token storage**: In-memory `ConcurrentHashMap` with TTL eviction (60s). If multi-instance, use Redis with TTL key. Single-use enforced by delete-on-consume.

**Security**: One-time use prevents replay. 60s TTL prevents stale tokens. Token is JWT-signed by stigmer-service so exchange endpoint can verify without shared state (stateless validation + consumed-set for replay protection).

**Affected code:**
- New: `stigmer-cloud/.../agentrunner/launch/LaunchTokenController.java`
- New: `stigmer-cloud/.../agentrunner/launch/LaunchTokenService.java`
- New: `stigmer-cloud/.../agentrunner/launch/LaunchToken.java`
- Modified: `HttpSecurityConfig.java` — permit `/v1/agent-runners/exchange-launch-token`

**Effort**: ~1 day

---

### T03: CLI `stigmer://` URL Scheme Registration (Go)

**Goal**: Register the Stigmer CLI as the handler for `stigmer://` URLs so the OS knows to dispatch them.

**Platform implementations:**

**macOS**: Create a minimal `.app` bundle wrapper at `~/.stigmer/Stigmer URL Handler.app` that forwards to the CLI binary. Register via `lsregister`. The `.app` bundle needs an `Info.plist` with `CFBundleURLTypes`. Alternative: register via `duti` or direct LaunchServices API.

**Linux**: Install a `.desktop` file at `~/.local/share/applications/stigmer-url-handler.desktop` with `MimeType=x-scheme-handler/stigmer`. Register via `xdg-mime default stigmer-url-handler.desktop x-scheme-handler/stigmer`.

**Windows**: Write registry key at `HKCU\Software\Classes\stigmer` with `shell\open\command` pointing to the CLI binary path.

**New CLI command**: `stigmer setup url-handler` — runs platform-specific registration. `stigmer setup url-handler --check` — verifies registration is active. Integrated into `stigmer init` as an optional step.

**Affected code:**
- New: `client-apps/cli/internal/cli/urlhandler/register.go` (platform dispatch)
- New: `client-apps/cli/internal/cli/urlhandler/register_darwin.go`
- New: `client-apps/cli/internal/cli/urlhandler/register_linux.go`
- New: `client-apps/cli/internal/cli/urlhandler/register_windows.go`
- New: `client-apps/cli/cmd/stigmer/root/setup.go` (setup command group)
- Modified: `client-apps/cli/cmd/stigmer/root.go` (register setup command)

**Effort**: ~1–2 days

---

### T04: CLI URL Handler — Receive `stigmer://` and Launch Runner (Go)

**Goal**: When the OS dispatches `stigmer://launch-runner?token=...&runtime=cli-daemon`, the CLI receives it, exchanges the token, and starts a runner.

**Flow:**
1. CLI main binary detects `stigmer://` as argv[1] (URL scheme dispatch passes the full URL as the first argument)
2. Parses URL: extract `token`, `runtime`, `name` query parameters
3. Calls `POST /v1/agent-runners/exchange-launch-token` with the one-time token
4. Receives back `{ stigmerToken, endpoint, runnerId }`
5. Stores `stigmerToken` in `~/.stigmer/credentials` (or keychain on macOS)
6. Stores cloud endpoint in config
7. Calls the existing `runner.Start()` flow — same path as `stigmer up runner`
8. Writes runner state to `~/.stigmer/runners/<name>.json`

**URL scheme detection**: In `main.go` or root command, check if `os.Args[1]` starts with `stigmer://`. If so, route to URL handler instead of normal Cobra command parsing.

**Affected code:**
- New: `client-apps/cli/internal/cli/urlhandler/handler.go` (URL parse + orchestration)
- Modified: `client-apps/cli/cmd/stigmer/main.go` (URL scheme detection)
- Reuses: `client-apps/cli/internal/cli/runner/start.go` (existing runner start)
- Reuses: `client-apps/cli/internal/cli/runner/backend_info.go` (credential storage)

**Dependencies**: T02 (launch token endpoint), T03 (URL scheme registered)

**Effort**: ~1 day

---

### T05: Docker Placement (Go CLI)

**Goal**: `stigmer up runner --runtime docker` runs the agent inside a Docker container instead of as a native Python process.

**Implementation:**
- New `--runtime` flag on `stigmer up runner` (values: `native` (default), `docker`)
- When `runtime=docker`, instead of spawning Python subprocess, run:
  ```
  docker run -d --name stigmer-runner-<slug> \
    -e STIGMER_TOKEN=<token> \
    -e STIGMER_BACKEND_ENDPOINT=<endpoint> \
    -e STIGMER_TASK_QUEUE=<queue> \
    -e STIGMER_AGENT_RUNNER_ID=<id> \
    -v $PWD:/workspace \
    ghcr.io/stigmer/agent-runner:<version>
  ```
- Runner state file tracks Docker container ID for lifecycle management
- `stigmer down runner <name>` does `docker stop` + `docker rm` when runtime is docker
- Image version defaults to matching the CLI version; `--image` flag for override
- Health check: after `docker run`, poll `docker inspect` for running state, then wait for heartbeat

**Affected code:**
- New: `client-apps/cli/internal/cli/runner/docker.go` (Docker lifecycle)
- Modified: `client-apps/cli/internal/cli/runner/start.go` (runtime dispatch)
- Modified: `client-apps/cli/internal/cli/runner/stop.go` (Docker stop path)
- Modified: `client-apps/cli/internal/cli/runner/state.go` (container ID in state)
- Modified: `client-apps/cli/cmd/stigmer/root/up.go` (`--runtime` flag)

**No dependencies on other tasks** — can start in parallel.

**Effort**: ~1–2 days

---

### T06: Runner Stop via Command Stream (Proto + Go + Java + Python)

**Goal**: Add a `Shutdown` command so the server can tell a runner to stop gracefully.

**Proto change**: Add `SHUTDOWN` to the command oneof in the runner command stream. The shutdown command carries a `reason` string for logging.

**Server-side (Go OSS)**: When a "stop runner" request comes in, look up the runner's active stream in `stream_registry`, send `Shutdown` command. If no active stream (runner offline), update runner status to STOPPED directly.

**Server-side (Java cloud)**: Same logic via Redis pub/sub to route the shutdown command to the correct instance holding the stream.

**Python agent-runner**: Handle `Shutdown` in the stream command handler. Trigger the same graceful shutdown path as the idle watchdog: SIGTERM to self → final STOPPED heartbeat → Temporal drain → clean exit.

**Go CLI daemon**: Handle `Shutdown` in `runner_stream_commands.go` for the Go supervisor process.

**API surface**: New SDK method `stigmer.runner.stop(id)` that calls `sendCommand(Shutdown)`.

**Affected code:**
- Modified proto: `apis/ai/stigmer/agentic/runner/v1/` (add Shutdown to command oneof)
- Modified Go: `backend/services/stigmer-server/.../agentrunner/controller/` (stop handler)
- Modified Java: `stigmer-cloud/.../agentrunner/` (stop handler via stream)
- Modified Python: `backend/services/agent-runner/` (handle shutdown command)
- Modified Go CLI: `client-apps/cli/internal/cli/runner/` (handle shutdown in stream commands)
- Codegen: regenerate stubs across languages

**No dependencies on other tasks** — can start in parallel.

**Effort**: ~1 day

---

### T07: SDK Runner Action Hooks (TypeScript/React)

**Goal**: React hooks for runner management actions used by the web UI.

**New hooks:**
- `useStopRunner()` — calls `stigmer.runner.stop(id)` (wraps sendCommand Shutdown)
- `useDeleteRunner()` — calls `stigmer.runner.delete(id)` (existing SDK method)
- `useLaunchLocalRunner()` — calls launch-token endpoint, constructs `stigmer://` URL, opens it via `window.location.href`, starts polling for new runner
- `useCreateCloudRunner()` — calls `stigmer.runner.create(...)` for persistent cloud runners

**Enhance RunnerListPanel**: Accept action callbacks (`onStop`, `onDelete`) and render action buttons per runner row.

**Affected code:**
- New: `sdk/react/src/runner/useStopRunner.ts`
- New: `sdk/react/src/runner/useDeleteRunner.ts`
- New: `sdk/react/src/runner/useLaunchLocalRunner.ts`
- New: `sdk/react/src/runner/useCreateCloudRunner.ts`
- Modified: `sdk/react/src/runner/RunnerListPanel.tsx` (action buttons)
- Modified: `sdk/react/src/runner/index.ts` (exports)
- Modified: `sdk/react/src/index.ts` (exports)

**Dependencies**: T06 (stop command in SDK), T02 (launch token endpoint for useLaunchLocalRunner)

**Effort**: ~1 day

---

### T08: Web UI — Settings > Runners Full CRUD (React)

**Goal**: Upgrade the read-only Runners page to full management with action buttons.

**Features:**
- **"Launch Local Runner" button**: Triggers `useLaunchLocalRunner()`. Shows brief explainer dialog. Starts polling. If CLI not detected (3s timeout), shows install instructions.
- **"Create Cloud Runner" button**: For persistent cloud runners. Uses `useCreateCloudRunner()`.
- **Stop button** per runner row: Calls `useStopRunner()`. Disabled for STOPPED/FAILED runners.
- **Delete button** per runner row: Calls `useDeleteRunner()` with confirmation dialog.
- **"Show system runners" toggle**: Uses existing `includeSystemManaged` option on `useRunnerList`.
- **Execution routing indicator**: When a session is bound to a specific runner, show "Running on alice-macbook" in the session view.

**Affected code:**
- Modified: `sdk/react/src/runner/RunnerListPanel.tsx` (action slots)
- Modified: `client-apps/web/src/components/settings/RunnersSection.tsx` (wire actions)
- New: `sdk/react/src/runner/LaunchRunnerDialog.tsx` (launch flow with polling + fallback)
- New: `sdk/react/src/runner/DeleteRunnerDialog.tsx` (confirmation)

**Dependencies**: T07 (SDK hooks)

**Effort**: ~1–2 days

---

### T09: Integration Testing

**Goal**: End-to-end validation of the full Phase 3 flow.

**Test scenarios:**
1. Launch flow: browser → launch token → `stigmer://` → CLI → token exchange → runner starts → appears in UI as Ready
2. Stop flow: click Stop → command stream Shutdown → runner graceful exit → UI shows Stopped
3. Delete flow: click Delete → runner resource removed → process stops heartbeating
4. Docker flow: `stigmer up runner --runtime docker` → container running → heartbeat active → stop kills container
5. Dispatch: select local runner in composer → execution runs on local runner
6. Fallback: `stigmer://` with no CLI installed → install dialog shown after timeout

**Effort**: ~1 day

## Dependency Graph

```
T02 (launch tokens) ──┐
                       ├──► T04 (CLI URL handler) ──┐
T03 (URL registration) ┘                             │
                                                      ├──► T09 (integration)
T05 (Docker) ─────────────────────────────────────────┤
                                                      │
T06 (stop command) ──► T07 (SDK hooks) ──► T08 (UI) ─┘
```

**Parallelizable**: T02, T03, T05, T06 can all start simultaneously.

## Estimated Effort

| Task | Effort | Dependencies |
|------|--------|--------------|
| T02: Launch token endpoints | 1 day | None |
| T03: URL scheme registration | 1–2 days | None |
| T04: CLI URL handler | 1 day | T02, T03 |
| T05: Docker placement | 1–2 days | None |
| T06: Runner stop command | 1 day | None |
| T07: SDK hooks | 1 day | T06, T02 |
| T08: Web UI CRUD | 1–2 days | T07 |
| T09: Integration testing | 1 day | All |
| **Total** | **~8–11 days** | |

## What does NOT depend on Phase 0 deploy

All of this work is independent of the Phase 0 proxy deploy. Local/persistent runners use their own credentials. Phase 0 deploy is only needed for cloud ephemeral runners to be credential-free.

## Success Criteria for T01 (this plan)

- [ ] Task breakdown reviewed and approved
- [ ] Dependency order confirmed
- [ ] No missing capabilities identified
- [ ] Ready to begin T02–T06 in parallel

## Next Steps

1. **You approve this plan** — or request adjustments
2. We begin T02, T03, T05, T06 in parallel (4 independent streams)
3. T04 follows once T02+T03 are done
4. T07→T08→T09 follow in sequence
