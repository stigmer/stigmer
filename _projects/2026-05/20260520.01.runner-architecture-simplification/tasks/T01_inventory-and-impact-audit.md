# T01: Codebase Inventory & Impact Audit

**Status**: Complete
**Date**: 2026-05-20

## Objective

Map every file, service, and integration point across both repos that must be deleted, refactored, or created to execute the runner architecture simplification.

---

## 1. Runner API Proto Files (DELETE)

**Directory**: `apis/ai/stigmer/agentic/runner/v1/` (stigmer OSS)
**Package**: `ai.stigmer.agentic.runner.v1`
**Build**: Buf-based codegen (no per-proto BUILD.bazel); stubs generated into `apis/stubs/{go,ts,java,python}`

| # | File | Defines |
|---|------|---------|
| 1 | `api.proto` | `Runner`, `RunnerStatus`, `RunnerConnectionInfo` — core resource |
| 2 | `spec.proto` | `RunnerSpec` — user-declared desired state |
| 3 | `enum.proto` | `RunnerPhase` enum (PENDING, STARTING, READY, BUSY, STOPPED, FAILED) |
| 4 | `io.proto` | IDs, list types, bidi stream envelopes, heartbeats, commands (ListDirectory, Stop), launch-token messages |
| 5 | `command.proto` | `RunnerCommandController` service: apply, create, update, delete, sendCommand, stop, connect (bidi), createLaunchToken, exchangeLaunchToken |
| 6 | `query.proto` | `RunnerQueryController` service: get, getByReference, list |

**Generated stubs to delete**:
- `apis/stubs/go/ai/stigmer/agentic/runner/v1/` (+ BUILD.bazel)
- `apis/stubs/ts/.../runner/v1/`
- `apis/stubs/java/.../runner/v1/` (57 files in stigmer-cloud)
- `apis/stubs/python/.../runner/v1/`

**Cross-references from other protos** (refactor, not delete):
- `session/v1/spec.proto` → `string runner_id = 9` — remove or repurpose
- `agentexecution/v1/api.proto` → `string runner_id = 19` in `AgentExecutionStatus` — remove
- `commons/.../api_resource_kind.proto` → `runner = 46` — remove enum value

**Buf module**: Published as `buf.build/stigmer/stigmer`; `stigmer-cloud` consumes it. Proto deletion cascades to cloud stubs on next buf gen.

---

## 2. Runner Service TypeScript Code (REFACTOR → NPM package)

**Directory**: `backend/services/runner/` (stigmer OSS)
**Package name**: Already `@stigmer/runner` in `package.json`
**~120 production `.ts` files** under `src/`

### Current architecture (3 execution planes in one process)

| Plane | Key files |
|-------|-----------|
| Agent executions | `activities/execute-cursor/`, `activities/execute-deep-agent/`, middleware stack |
| MCP connect | `workflows/connect-mcp-server.ts`, `activities/discover-mcp-server.ts` |
| Serverless workflows | `workflows/execute-serverless-workflow.ts`, `workflow-engine/` kernel |

### Temporal worker setup
- `src/worker.ts` — `Worker.create({ taskQueue: config.taskQueue, activities, workflowsPath })`
- Queue from env: `STIGMER_TASK_QUEUE` (default `agent_execution_runner`)
- Connection: `NativeConnection.connect({ address: config.temporalAddress })`

### Control plane coupling (must change)
- `src/heartbeat.ts` — bidi `RunnerCommandController.connect` stream (DELETE — uses Runner API)
- `src/client/stigmer-client.ts` — Connect-RPC client for status, billing, session, agent queries (KEEP — but decouple from runner identity)
- `src/config.ts` — `STIGMER_RUNNER_ID` drives heartbeat opt-in (refactor to session-based)

### Key refactoring targets
- `main.ts` → extract `createStigmerRunner()` factory; keep `main.ts` as opinionated CLI entry
- `heartbeat.ts` → DELETE entirely (Runner API dependency)
- `idle-watchdog.ts` → DELETE or simplify (reported via heartbeat to Runner status)
- `config.ts` → replace `STIGMER_RUNNER_ID` + `STIGMER_TASK_QUEUE` with `sessionTaskQueue` param

### Sibling services (migration context)
- `backend/services/cursor-runner/` — legacy Cursor-only TS worker (CLI still launches this)
- `backend/services/agent-runner/` — Python Temporal worker (CLI still launches this)
- `backend/services/workflow-runner/` — Go CNCF workflow engine (being ported into `workflow-engine/`)

---

## 3. Java Control Plane — stigmer-cloud (DELETE + REFACTOR)

**All Runner resource code** lives in `stigmer-service` only.

### DELETE — Runner domain package (24 production + 5 test files)

**`domain/agentic/runner/`**:

| Layer | Files | Key classes |
|-------|-------|-------------|
| Controller | 1 | `RunnerGrpcAutoController` (generates command + query controllers) |
| Handlers | 12 | Apply, Create, Update, Delete, SendCommand, Stop, Connect (bidi), Get, GetByReference, List, CreateLaunchToken, ExchangeLaunchToken |
| Services | 2 | `RunnerHeartbeatService`, `LaunchTokenService` |
| Stream | 3 | `RunnerStreamRegistry`, `RunnerStreamEntry`, `RunnerCommandRedisCoordinator` |
| Launcher | 5 | `RunnerLauncher` (interface), `NoopRunnerLauncher`, `DaytonaSandboxRunnerLauncher`, `RunnerLauncherConfig`, `ProvisionInfrastructureStep` |
| Repo | 1 | `RunnerRepo` (MongoDB collection `runner`) |
| Tests | 5 | LaunchTokenService, SendCommand, Stop, HeartbeatService, StreamRegistry |

### DELETE — Downstream gRPC repo
- `downstream/agentic/runner/RunnerGrpcRepo.java`
- `downstream/agentic/runner/RunnerGrpcRepoImpl.java`

### DELETE — Database
- **MongoDB collection**: `runner`
- **Migration**: `U20260421_RunnerIndexes` (Mongock)
- **FGA model**: `fga/model/agentic/runner.fga` + `organization.fga` (`can_create_runner`)

### DELETE — Configuration
- `application-runner-launcher.yaml` — `stigmer.runner-launcher.*` properties
- K8s overlays: `STIGMER_RUNNER_LAUNCHER_TYPE`, `DAYTONA_API_KEY`, etc.
- Bazel test targets: 5 runner-related test rules

### REFACTOR — Cross-domain consumers (8+ files)

These reference `RunnerRepo`, `RunnerDispatchService`, or runner proto — need routing logic replaced with per-session queues:

| File | Current runner usage |
|------|---------------------|
| `RunnerDispatchService.java` | Core dispatch: session → runner → task queue |
| `WorkflowExecutionDispatchService.java` | Workflow dispatch: always provisions ephemeral runner |
| `AgentExecutionCreateHandler.java` | Calls `RunnerDispatchService.resolveOrProvision()` |
| `AgentExecutionRecoverHandler.java` | Runner dispatch on recovery |
| `McpServerConnectHandler.java` | Dispatch for MCP connect workflows |
| `WorkflowExecutionCreateHandler.java` | Calls `WorkflowExecutionDispatchService` |
| `InvokeAgentExecutionWorkflowCreator.java` | Sets memo `activityTaskQueue` from dispatch result |
| `InvokeAgentExecutionWorkflowImpl.java` | Reads memo for activity stub task queues |
| `ProtoFgaSchemaConsistencyTest.java` | Registers runner proto descriptors |
| `RunnerUnavailableException.java` (×2) | Custom exception |

---

## 4. Session-to-Runner Routing (REPLACE)

### Current model
```
Session.spec.runner_id (FK) → Runner resource → Runner.status.task_queue ("runner:{id}")
                                                         ↓
                                            Temporal memo: activityTaskQueue
                                                         ↓
                                            Activities scheduled on runner's queue
```

### Dispatch priority (cloud `RunnerDispatchService`)
1. Session has `runner_id` + runner READY/BUSY → `runner.status.task_queue`
2. No binding + launcher=daytona → provision ephemeral Runner → `runner:{newId}`
3. No binding + launcher=noop → global fallback `agent_execution_runner`

### Key finding: memo-based routing is the right abstraction
The Temporal workflow memo `activityTaskQueue` already decouples the dispatch decision from activity scheduling. **Only the string resolution needs to change** — from `runner:{runnerId}` to `session:{sessionId}`.

### Files that implement current routing

| Repo | File | Role |
|------|------|------|
| stigmer-cloud | `RunnerDispatchService.java` | Resolves session → runner → queue |
| stigmer-cloud | `WorkflowExecutionDispatchService.java` | Workflow dispatch |
| stigmer-cloud | `InvokeAgentExecutionWorkflowCreator.java` | Sets memo |
| stigmer-cloud | `InvokeAgentExecutionWorkflowImpl.java` | Reads memo |
| stigmer (OSS) | `agentexecution/temporal/dispatch.go` | OSS dispatch (stricter, no fallback) |
| stigmer (OSS) | `session/controller/resolve_runner.go` | Auto-bind sole READY runner |

### What does NOT exist today
- No `session:{sessionId}` queue naming anywhere
- Cloud never writes back `runner_id` to session after ephemeral provisioning
- No per-session task queue concept

---

## 5. Desktop App Integration (REFACTOR)

**Important**: Desktop is **Tauri v2** (Rust + webview), NOT Electron.

### Current architecture
Desktop app → spawns Go CLI sidecar (`stigmer up runner --standalone --json`) → CLI registers Runner API resource → starts Python agent-runner + cursor-runner processes → heartbeats via bidi gRPC stream

### Runner lifecycle chain
| Component | Files |
|-----------|-------|
| Rust sidecar management | `src-tauri/src/sidecar.rs` — start, stop, health, logs |
| Tauri IPC commands | `lib.rs` — start_runner, stop_runner, list_local_runners, query_runner_socket |
| Tauri events | `runner:started`, `runner:stopped`, `runner:log`, `runner:error` |
| Frontend hooks | `useStartRunner`, `useStopLocalRunner`, `useLocalRunners`, `useLocalRunnerStatus`, `useAutoEnsure` |
| UI pages | `RunnersPage`, `ThisMachineCard`, `OrgFleetSection`, `RunnerDetailPage`, `RunnerLogViewer` |
| Deep link | `useDeepLinkHandler` — `stigmer://launch-runner?token=...` → exchangeLaunchToken → start |
| Health | Unix socket `~/.stigmer/run/runner.sock` + disk state `~/.stigmer/runners/*.json` |
| System tray | `tray.rs` — tooltip, runner list, "Stop All Runners" |

### Key finding: no direct runner embed today
Desktop does NOT embed the TypeScript runner. It orchestrates the **Go CLI**, which handles registration, process management, and control socket. The desktop app reads runner status from disk + socket + control plane polling.

### Filesystem browsing
Uses **native Tauri folder dialog** (`@tauri-apps/plugin-dialog`), NOT the runner bidi `ListDirectory` command. This is already the correct pattern.

### Migration impact
- CLI `stigmer up runner` → must stop registering Runner API resource; instead derive task queue from session
- Desktop UI → `/runners` page, tray, notifications need rethinking (no more "Runner" concept visible to user)
- Launch token flow → DELETE (runner embeds with app's auth context)
- Control socket contract → simplify (no runner ID, just local worker health)

---

## 6. Cloud Sandbox Integration (REFACTOR)

### Current architecture
Control plane (`stigmer-service`) → creates ephemeral Runner resource → `DaytonaSandboxRunnerLauncher` provisions Daytona sandbox → injects env (`STIGMER_RUNNER_ID`, `STIGMER_TASK_QUEUE=runner:{id}`) → boots 3 workers in `agent-sandbox-full` image → workers poll runner's task queue

### Key components

| Component | Location | Action |
|-----------|----------|--------|
| `DaytonaSandboxRunnerLauncher` | stigmer-cloud domain/runner/launcher | REFACTOR — decouple from Runner resource |
| `RunnerLauncherConfig` | stigmer-cloud domain/runner/launcher | REFACTOR — move to session/sandbox package |
| `NoopRunnerLauncher` | stigmer-cloud domain/runner/launcher | REFACTOR or DELETE |
| `ProvisionInfrastructureStep` | stigmer-cloud domain/runner/launcher | REFACTOR — trigger from session, not runner create |
| Sandbox Docker images | stigmer OSS `agent-runner/sandbox/` | KEEP — change env contract |
| CI pipeline | `.github/workflows/release.sandbox-cloud.yaml` | KEEP — minor env changes |
| Side-channel proxy | stigmer-cloud `proxy/` controllers | KEEP — orthogonal to runner identity |

### Env vars injected into sandboxes (current → target)
| Current | Target |
|---------|--------|
| `STIGMER_RUNNER_ID` | DELETE |
| `STIGMER_TASK_QUEUE=runner:{id}` | `STIGMER_TASK_QUEUE=session:{sessionId}` |
| `MODE=cloud` | KEEP |
| `STIGMER_TOKEN`, `TEMPORAL_SERVICE_ADDRESS`, etc. | KEEP |

### Lifecycle changes
- Sandbox provisioned per-session instead of per-runner-resource
- No Runner MongoDB document needed for sandbox tracking
- Sandbox ID stored on session (or just in Daytona, retrieved by session ID)
- Idle timeout logic moves from `RunnerHeartbeatService` to session-level or Temporal workflow timeout

---

## 7. Blast Radius Summary

### DELETE (clean removal)

| Category | Count | Repo |
|----------|-------|------|
| Proto source files | 6 | stigmer |
| Generated proto stubs (all languages) | ~80+ | both |
| Java domain/runner package | 24 prod + 5 test | stigmer-cloud |
| Java downstream gRPC repo | 2 | stigmer-cloud |
| MongoDB collection + migration | 1 + 1 | stigmer-cloud |
| FGA model | 1 + org relation | stigmer-cloud |
| Spring config YAML | 1 | stigmer-cloud |
| K8s overlay runner-launcher vars | ~10 env vars | stigmer-cloud |
| Bazel test targets | 5 | stigmer-cloud |
| TS heartbeat module | 1 (`heartbeat.ts`) | stigmer |
| TS idle-watchdog | 1 (`idle-watchdog.ts`) | stigmer |
| `api_resource_kind.proto` entry | 1 enum value | stigmer |

### REFACTOR (change routing/identity model)

| Category | Count | Repo |
|----------|-------|------|
| Java cross-domain dispatch | 8+ files | stigmer-cloud |
| TS runner config + main | 2 files | stigmer |
| TS stigmer-client | 1 file | stigmer |
| Session proto | 1 field (`runner_id`) | stigmer |
| AgentExecution proto | 1 field (`runner_id`) | stigmer |
| OSS Go dispatch + session | 3+ files | stigmer |
| Desktop CLI sidecar | 5+ files (Rust + Go) | stigmer |
| Desktop frontend | 15+ hooks/pages | stigmer |
| Sandbox launcher | 4 Java files | stigmer-cloud |
| Sandbox env injection | 2 env vars | stigmer-cloud |
| SDK React hooks | 2+ files | stigmer |

### CREATE (new code)

| Category | Description | Repo |
|----------|-------------|------|
| `createStigmerRunner()` factory | Exported entry point for NPM package | stigmer |
| Session-based dispatch service | Replace `RunnerDispatchService` | stigmer-cloud |
| Session-based sandbox provisioner | Decouple from Runner create pipeline | stigmer-cloud |
| Per-session queue naming | `session:{sessionId}` convention | both |

---

## 8. Recommended Task Sequence

Based on this audit, the optimal execution order is:

| Task | Description | Deps | Risk |
|------|-------------|------|------|
| **T02** | Delete Runner API protos + regenerate stubs | None | Low — clean removal |
| **T03** | Scaffold `createStigmerRunner()` factory in `@stigmer/runner` | None (parallel with T02) | Low |
| **T04** | Implement per-session Temporal task queue routing in TS runner | T03 | Medium |
| **T05** | Refactor Java control plane: delete Runner domain, add session-based dispatch | T02 (protos gone) | High — largest refactor |
| **T06** | Refactor desktop app: embed runner, remove Runner UI/launch tokens | T03, T04 | Medium |
| **T07** | Refactor cloud sandbox: session-based provisioning | T05 | Medium |
| **T08** | End-to-end validation | All above | Low |

**Critical path**: T02 → T05 (Java needs protos deleted first) and T03 → T04 → T06 (desktop needs working NPM package).

**Highest risk**: T05 (Java control plane) — 8+ cross-domain files, dispatch logic is the routing backbone, and the Daytona launcher must be decoupled from the Runner create pipeline.
