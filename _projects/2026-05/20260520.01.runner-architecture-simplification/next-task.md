# Next Task: 20260520.01.runner-architecture-simplification

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260520.01.runner-architecture-simplification

**Description**: Eliminate the overengineered Runner API resource (CRUD, bidi stream, 6-phase lifecycle, launch tokens) and replace it with a simple @stigmer/runner NPM package using per-session Temporal task queue routing. No backward compatibility — delete the Runner API entirely.
**Goal**: Single @stigmer/runner NPM package with a createStigmerRunner() factory function that uses per-session Temporal task queues. Runner API protos deleted. Control plane routes executions via session-derived task queues instead of runner IDs. Desktop app embeds the runner automatically. Cloud sandbox boots with session ID. Customers can npm install and integrate in minutes.
**Tech Stack**: TypeScript/Node.js, Temporal TypeScript SDK, Protobuf/gRPC (deletion), Java Spring Boot (stigmer-service control plane changes), Vitest
**Components**: apis/ai/stigmer/agentic/runner (DELETED), backend/services/runner (refactored), stigmer-cloud/stigmer-service Runner domain (DELETED), session routing in both stigmer-server and stigmer-service, desktop app runner lifecycle (DELETED), Electron IPC for filesystem browsing

## Current Status

**Created**: 2026-05-20
**Current Task**: Sandbox token exchange implemented
**Status**: Cloud sandbox token exchange complete. SandboxTokenService mints session-scoped Stigmer-signed JWTs (4h TTL) instead of forwarding the caller's raw JWT. Stale-token-aware sandbox recreation handles expiry. All 61 Java Bazel tests pass. E2E integration test suite also in progress (separate conversation).

## Session Progress (2026-05-21, Session 12)

### What was accomplished
- **Implemented sandbox token exchange service** — replaces forwarded user JWT with purpose-built session-scoped tokens
  - Created `SandboxTokenService` in `domain/agentic/sandbox/` — mints Stigmer-signed JWTs (RSA256, `iss=stigmer`, `sub=identityAccountId`) with `session_id`, `token_type=sandbox`, `org` claims and 4h configurable TTL
  - Added `sandboxTokenTtlSeconds` (default 14400) to `StigmerJwtSigningConfig` in shared `api-authentication` lib
  - Added `tokenExpiresAt` field to `SessionSandbox` record with `isTokenStale(graceSeconds)` method (nullable for backward compatibility with legacy records)
  - Updated `SessionSandboxRepo` to persist/read `token_expires_at` in MongoDB
  - Renamed `SandboxEnvironment.userJwt` to `sandboxToken`, added `tokenExpiresAt` field
  - Added stale-token check in `DaytonaSandboxProvisioner.ensureExistingSandbox` — if token is expired or within 10-minute grace window, recreates sandbox instead of restarting (Daytona preserves original env vars on restart)
  - Updated both `EnsureSessionSandboxStep` (create + recover handlers) to resolve caller identity from `InterceptorContextHolder` and mint via `SandboxTokenService` instead of forwarding `UserTokenHolder.get()`
  - 7 unit tests for `SandboxTokenService` (claims, TTL, JTI uniqueness, missing key error)
  - 4 new stale-token tests in `DaytonaSandboxProvisionerTest` (expired, grace window, fresh, legacy null)
  - All 61 Java Bazel tests pass

### Key changes
1. **New**: `SandboxTokenService.java` — session-scoped JWT minting (~100 lines)
2. **New**: `SandboxTokenServiceTest.java` — 7 unit tests
3. **Modified**: `StigmerJwtSigningConfig.java` — added `sandboxTokenTtlSeconds` property
4. **Modified**: `SessionSandbox.java` — added `tokenExpiresAt` field + `isTokenStale()` method
5. **Modified**: `SessionSandboxRepo.java` — persist/read `token_expires_at`
6. **Modified**: `SandboxEnvironment.java` — renamed `userJwt` to `sandboxToken`, added `tokenExpiresAt`
7. **Modified**: `DaytonaSandboxProvisioner.java` — stale-token check + store `tokenExpiresAt`
8. **Modified**: `AgentExecutionCreateHandler.java` — `EnsureSessionSandboxStep` uses `SandboxTokenService`
9. **Modified**: `AgentExecutionRecoverHandler.java` — same change in recover handler
10. **Modified**: `BUILD.bazel` — added `@maven//:com_auth0_java_jwt` dependency
11. **Modified**: `DaytonaSandboxProvisionerTest.java` — 4 new stale-token tests

### Decisions made
- **4h TTL, no renewal**: Sandbox token lasts 4 hours. When it expires, `ensureExistingSandbox` detects staleness and recreates the sandbox from scratch (30-60s cold start). Renewal mechanism deferred — the recreate-on-stale approach is simpler and covers all edge cases.
- **No proxy-level scope enforcement**: FGA remains the sole authorization boundary. The `session_id` claim is for audit, not enforcement. Scope enforcement can be layered on later as an additive change.
- **Reuse existing auth chain**: Sandbox tokens use `iss=stigmer` and flow through `PlatformClientTokenAuthenticationProvider`. The `platform_client_id` claim is absent (null) — verified that `RequestCallerIdentityMapper` and FGA handle this correctly.
- **Domain service, not auth primitive**: `SandboxTokenService` lives in `domain/agentic/sandbox/` (not `api-authentication` lib) because it's a domain-specific concern, not a reusable auth building block.
- **Caller identity from interceptor context**: Used `InterceptorContextHolder.getContext().getCaller().getIdentityAccountId()` instead of `UserTokenHolder.get()` — the interceptor context is in gRPC Context (survives SecurityContextHolder mutations from in-process calls).

### Surprises discovered
- None — the implementation followed the plan exactly. The auth chain compatibility (null `platformClientId`) was verified by code reading and confirmed by all tests passing.

## Session Progress (2026-05-21, Session 11)

### What was accomplished
- **Created session routing E2E integration test suite** — new `test/integration-session-routing/` module
  - Tier 1 (offline, 4 tests): Temporal workflow memo verification — proves `SessionDispatchService.resolve()` correctly routes to `session:{id}` queues
  - Tier 2 (offline, 4 tests): Runner IPC + activity dispatch — unified runner manager picks up `ExecuteCursor` on per-session queues
  - Tier 3 (provider-backed, 3 tests): Full E2E with `CURSOR_API_KEY` — session routing through to COMPLETED execution
  - Cloud control plane (2 tests): CLOUD execution target routing with noop sandbox provisioner
- **Extended shared harness** (`test/integration/harness/`)
  - `service.go`: Added `ActivityRouting`, `DefaultExecutionTarget`, `SandboxType` to `ServiceConfig` + `sandbox` Spring profile
  - `temporal.go`: Added `Client()` method for Temporal Go SDK workflow memo verification
  - `unified_runner.go`: New file (~450 lines) — `UnifiedRunnerManager` (IPC mode) + `UnifiedRunnerStatic` (single-queue mode)
  - `harness_config.go`: Added `WithExecutionTarget` session option
  - `benchmark_helpers.go`: Fixed pre-existing `GetRunnerUsage` → `GetStreamingUsage` rename
- **Build infrastructure**: `go.mod`, `BUILD.bazel`, `Makefile` (offline + provider lanes), root `go.work` + `Makefile` delegate targets
- All Go builds clean (`go vet -tags integration` passes)

### Key changes
1. **New**: `test/integration-session-routing/` — 7 files (suite, 4 test files, go.mod, Makefile, BUILD.bazel)
2. **New**: `test/integration/harness/unified_runner.go` — IPC manager + static runner helpers
3. **Modified**: `test/integration/harness/service.go` — session routing config fields
4. **Modified**: `test/integration/harness/temporal.go` — Temporal SDK client method
5. **Modified**: `test/integration/harness/harness_config.go` — WithExecutionTarget option
6. **Modified**: `test/integration/harness/benchmark_helpers.go` — RunnerUsage→StreamingUsage fix
7. **Modified**: `go.work` — added session-routing module
8. **Modified**: `Makefile` — two new delegate targets

### Decisions made
- **Separate test suite**: Session routing (`STIGMER_ACTIVITY_ROUTING=session`) changes dispatch for ALL requests — incompatible with existing global-routing suite's runners
- **CURSOR harness only**: Unified runner registers `ExecuteCursor` but not `ExecuteGraphton` (native). Native per-session routing requires Python agent-runner which lacks per-session support
- **Three-tier structure**: Offline memo verification (no runner), offline dispatch verification (runner, no API key), provider-backed E2E (runner + API key)
- **Temporal memo as verification point**: `DescribeWorkflowExecution` to read `activityTaskQueue` memo — proves routing without needing activity execution
- **No runners in TestMain**: Each test starts its own runner infrastructure, keeping Tier 1 completely runner-free

### Surprises discovered
- `benchmark_helpers.go` had a pre-existing `GetRunnerUsage` reference that should have been renamed to `GetStreamingUsage` during the T02 runner API removal — fixed as part of this session
- The `sandbox` Spring profile was missing from the test harness's `SPRING_PROFILES_ACTIVE` — the test `buildServiceEnv()` constructs profiles explicitly without `sandbox`, which means `EnsureSessionSandboxStep` was never loaded in tests
- The Java workflow still dispatches `ExecuteGraphton` for native harness, while the unified runner registers `ExecuteDeepAgent` — a name mismatch that means native per-session routing via the unified runner won't work until Java or TS is updated

## Session Progress (2026-05-21, Session 10)

### What was accomplished
- **Implemented cloud sandbox provisioning** — full Daytona integration for EXECUTION_TARGET_CLOUD sessions
  - Re-added `io.daytona:sdk:0.168.0` to MODULE.bazel
  - Created `domain/agentic/sandbox/` package with 7 classes: SessionSandbox entity, SessionSandboxRepo (MongoDB), SandboxProvisioner interface, DaytonaSandboxProvisioner (full lifecycle), NoopSandboxProvisioner, SandboxProvisionerConfig, SandboxEnvironment, SandboxProvisioningException
  - DaytonaSandboxProvisioner reuses core logic from deleted DaytonaSandboxRunnerLauncher — keyed on sessionId instead of runnerId, task queue is session:{id}, single Node.js runner
  - Created `EnsureSessionSandboxStep` pipeline step in AgentExecutionCreateHandler (after StartWorkflow, fire-and-forget, non-critical)
  - Same step added to AgentExecutionRecoverHandler for recovered executions
  - Added `DeprovisionSandboxStep` to SessionDeleteHandler for sandbox cleanup on session deletion
  - User JWT captured from UserTokenHolder.get() in gRPC context, passed in-memory to sandbox as STIGMER_TOKEN — never touches Temporal history
  - Created application-sandbox.yaml config with Daytona properties, added `sandbox` to Spring active profiles
  - Added `ExecutionTarget int32` to Go workflow input for forward-compatibility
  - 11 unit tests for DaytonaSandboxProvisioner (all lifecycle states) + 3 Go JSON round-trip tests
  - All 61 Java Bazel tests pass, all Go tests pass

### Key changes
1. **New**: `domain/agentic/sandbox/` package — 7 Java classes (~500 lines)
2. **New**: `application-sandbox.yaml` — Spring config for sandbox provisioning
3. **New**: `DaytonaSandboxProvisionerTest.java` — 11 tests for full lifecycle
4. **New**: `workflow_input_test.go` — 3 Go JSON round-trip tests
5. **Modified**: `MODULE.bazel` — re-added Daytona SDK
6. **Modified**: `AgentExecutionCreateHandler.java` — added EnsureSessionSandboxStep
7. **Modified**: `AgentExecutionRecoverHandler.java` — added EnsureSessionSandboxStep
8. **Modified**: `SessionDeleteHandler.java` — added DeprovisionSandboxStep
9. **Modified**: `SessionDispatchService.java` — made formatSessionTaskQueue public
10. **Modified**: Go `workflow_input.go` — added ExecutionTarget field
11. **Modified**: Go `create.go` — passes dispatch.ExecutionTarget to workflow input

### Decisions made
- **Pipeline step, not Temporal activity**: Sandbox provisioning runs as a pipeline step in the gRPC handler, not a Temporal activity. This preserves access to UserTokenHolder.get() (the user's JWT from the gRPC context) without putting secrets in Temporal workflow history. Same pattern as the deleted ProvisionInfrastructureStep.
- **Fire-and-forget**: The pipeline step is non-critical (isCritical=false). If provisioning fails, the workflow's agent activity eventually hits ScheduleToStartTimeout with a clear error. Same tradeoff as the old Runner architecture.
- **Full lifecycle handling**: DaytonaSandboxProvisioner handles all Daytona states (started, stopped, archived, not found) on every execution — not just first execution. Follow-up messages trigger the same ensure path.
- **User JWT for sandbox auth**: The caller's JWT is captured from the gRPC context and passed in-memory to the sandbox as STIGMER_TOKEN. This is the same pattern as the old DaytonaSandboxRunnerLauncher. The JWT has a limited lifetime; a TokenExchangeService for short-lived sandbox-scoped tokens is a follow-up.

### Surprises discovered
- The original plan used a Temporal activity for sandbox provisioning. This created a token problem — inside a Temporal activity, there's no gRPC context, so UserTokenHolder.get() doesn't work. The user caught this and redirected to the pipeline step approach, which is simpler and matches the old architecture.
- Daytona SDK 0.168.0 API has changed from the old code's assumptions: DaytonaConfig uses a Builder pattern (not setters), Sandbox.getState() returns String (not SandboxState enum), no SandboxInfo class. Adapted all code to the actual API.

## Session Progress (2026-05-21, Session 9)

### What was accomplished
- **Wired execution_target through session creation flow** — full SDK-to-server-to-guard implementation
  - Created `ExecutionTargetOption` type with `toProtoExecutionTarget`/`fromProtoExecutionTarget` converters in new `execution-target.ts`
  - Added `executionTarget` to `SharedSessionFields` in `useCreateSession`, mapped to proto enum
  - Added `executionTarget` as configuration value (not state) to `UseNewSessionFlowOptions`
  - Exposed `executionTarget` as read-only derived value on `useSessionPageFlow` (for future UI badge)
  - Fixed `buildUpdateInput` in `useSessionConversation` — was silently dropping `executionTarget` AND `cursorMode` during session updates
  - Desktop `SessionLauncher` passes `executionTarget: "local"` to `useNewSessionFlow`
  - Web `SessionLauncher` confirmed no changes needed (UNSPECIFIED = server decides)
  - Created Go `ValidateExecutionTargetImmutabilityStep` and registered in update pipeline
  - Created Java `ValidateExecutionTargetImmutabilityStep` nested class in `SessionUpdateHandler` and registered in update pipeline
  - Added 13 tests total: 4 Go, 5 Java, 2 React SDK (useNewSessionFlow), 2 React SDK (useCreateSession)
  - Exported `ExecutionTargetOption`, `toProtoExecutionTarget`, `fromProtoExecutionTarget` from `@stigmer/react`
  - All typechecks pass (React SDK, desktop lint+typecheck+cargo)

### Key changes
1. **New**: `sdk/react/src/session/execution-target.ts` — type + converters (~40 lines)
2. **New**: `backend/.../validate_execution_target_immutability.go` — Go immutability guard (~80 lines)
3. **New**: `stigmer-cloud/.../SessionUpdateExecutionTargetImmutabilityTest.java` — 5 Java tests
4. **Modified**: `useCreateSession.ts` — `executionTarget` on `SharedSessionFields`, mapped in `create()`
5. **Modified**: `useNewSessionFlow.ts` — `executionTarget` on options, included in `sessionFields`
6. **Modified**: `useSessionPageFlow.ts` — read-only `executionTarget` derived from session spec
7. **Modified**: `useSessionConversation.ts` — `buildUpdateInput` preserves `executionTarget` + `cursorMode`
8. **Modified**: Desktop `SessionLauncher.tsx` — `executionTarget: "local"`
9. **Modified**: Go `update.go` — registered new immutability step
10. **Modified**: Java `SessionUpdateHandler.java` — added nested step class + pipeline registration

### Decisions made
- `executionTarget` on `useNewSessionFlow` is a configuration value in `UseNewSessionFlowOptions`, NOT managed state — it's environment-determined (desktop=local, web=unspecified), not user-toggled like `harness`
- Same immutability sentinel as harness: `harness_state_id` non-empty means both harness and execution_target are locked
- UNSPECIFIED treated as LOCAL for immutability comparison (resolved at dispatch time, not stored)
- Web console does not set execution_target — leaves UNSPECIFIED so server config (`STIGMER_DEFAULT_EXECUTION_TARGET`) decides
- `fromProtoExecutionTarget` returns `undefined` for UNSPECIFIED (not "local") because the server hasn't resolved it yet

### Surprises discovered
- `buildUpdateInput` in `useSessionConversation.ts` was also silently dropping `cursorMode` during session updates — fixed alongside `executionTarget`. This would have been a latent bug when Cursor cloud mode is used with follow-up messages that trigger session updates.

## Session Progress (2026-05-21, Session 8)

### What was accomplished
- **Session proto field consolidation** — cross-repo rename and cleanup
  - Renamed `SessionSpec.thread_id` (field 3) to `harness_state_id` with comprehensive per-harness documentation
  - Deleted `SessionSpec.sandbox_id` (field 4) entirely (no reserved, no deprecated)
  - Confirmed `cursor_mode` and `execution_target` are orthogonal (not redundant) — kept both with improved docs
  - Updated Go server: renamed activity file, struct, method, constant; updated immutability guard, workflow dispatch
  - Updated TypeScript runners (unified + cursor-runner): proto field access, parameter names, comments
  - Updated Java cloud service: SessionContext record, UpdateExecutionStatusActivityImpl, workflow, immutability guard
  - Updated React SDK: useSessionConversation hook
  - Python agent-runner: no changes needed (all thread_id refs are LangGraph internals)
  - Regenerated all stubs via `make codegen` (OSS) and `make protos` (cloud)
  - Updated CLI embedded proto stubs
  - All builds compile, all tests pass

### Key changes
1. **Proto**: `apis/ai/stigmer/agentic/session/v1/spec.proto` — `thread_id` → `harness_state_id`, `sandbox_id` deleted
2. **Go**: `read_session_thread_id.go` → `read_harness_state_id.go`, `validate_harness_immutability.go`, `invoke_workflow_impl.go`
3. **TypeScript**: `execute-cursor/index.ts`, `session-lifecycle.ts`, `session-memory.ts` (both runners)
4. **Java**: `SessionContext.java`, `UpdateExecutionStatusActivityImpl.java`, `InvokeAgentExecutionWorkflowImpl.java`, `SessionUpdateHandler.java`
5. **React**: `useSessionConversation.ts`, `session-spec-converters.test.ts`

### Decisions made
- `harness_state_id` chosen over alternatives (`cursor_agent_id`) because it's generic enough for future harness types
- `sandbox_id` deleted without `reserved` — no one uses this system yet, clean break preferred
- LangGraph `thread_id` references in Python/TypeScript left unchanged — they are LangGraph API keys, not our proto field
- `ProxyAuthorizationService.sessionIdFromThreadId()` left unchanged — parses LangGraph format, not proto field
- Keep persisting `harness_state_id` for NATIVE harness (serves as immutability sentinel)

## Session Progress (2026-05-20, Session 7)

### What was accomplished
- **T06c: Desktop-owned embedded runner with execution target routing** — all 7 tracks complete
  - Track 0: Added `ExecutionTarget` enum (UNSPECIFIED/LOCAL/CLOUD) to session proto, codegen across Go/TS/Python/Java SDKs, updated Go + Java dispatch with `resolveExecutionTarget` and `DefaultExecutionTarget` config
  - Track 1: Created `createStigmerRunnerManager()` in `src/runner-manager.ts` — shared NativeConnection, dynamic addSession/removeSession, pool shutdown
  - Track 2: Added stdin/stdout JSON IPC protocol to `main.ts` — `STIGMER_RUNNER_MODE=manager` enters manager mode with newline-delimited JSON commands
  - Track 3: Created `src-tauri/src/runner.rs` with Tauri IPC commands (start_runner, stop_runner, add_session, remove_session, runner_status)
  - Track 4: Created `useEmbeddedRunner` hook + `EmbeddedRunnerContext` provider, mounted in App.tsx, wired `addSession` into SessionLauncher `onSessionCreated`
  - Track 5: Replaced workflow-runner + agent-runner + cursor-runner in daemon with single unified `runner` component, removed Python bootstrap requirement
  - Track 6: Fixed `stigmer up server` to pass `serverOnly: true` (was `false`)
  - Track 7: Added 7 new Go dispatch tests for execution target resolution, verified all 19 Go tests pass, 1451/1452 runner tests pass (1 pre-existing), 10/10 Java tests pass
  - Regenerated Java proto stubs in stigmer-cloud from updated OSS protos

### Key changes
1. **Proto**: `apis/ai/stigmer/agentic/session/v1/enum.proto` — `ExecutionTarget` enum
2. **Proto**: `apis/ai/stigmer/agentic/session/v1/spec.proto` — `execution_target` field 12
3. **Go dispatch**: `config.go` + `dispatch.go` — `DefaultExecutionTarget`, `resolveExecutionTarget()`
4. **Runner**: `src/runner-manager.ts` — dynamic per-session Worker pool (~310 lines)
5. **Runner**: `src/main.ts` — IPC manager mode (~185 lines added)
6. **Tauri**: `src-tauri/src/runner.rs` — spawn/manage runner process (~260 lines)
7. **React**: `useEmbeddedRunner.ts` + `EmbeddedRunnerContext.tsx` — hook + provider
8. **CLI**: `daemon_process.go` — `buildComponents` simplified to single runner
9. **CLI**: `daemon.go` — removed Python bootstrap, single Node.js runner bootstrap
10. **CLI**: `up.go` — `stigmer up server` passes `serverOnly: true`
11. **Java**: `SessionDispatchService` + `DispatchResult` + `AgentExecutionTemporalConfig` — execution target

### Decisions made
- `ExecutionTarget` is immutable once an execution has run (like harness)
- Both LOCAL and CLOUD use `session:{id}` queues — only differs in who provides the runner
- `DefaultExecutionTarget` config: OSS defaults to LOCAL, cloud defaults to CLOUD
- Runner manager uses one shared NativeConnection + shared activities across all Workers
- stdin/stdout JSON protocol matches LSP pattern (logs to stderr)
- Tauri runner commands are fire-and-forget (don't block on IPC response for add/remove)
- CLI daemon now requires the unified runner (Node.js) — removed Python agent-runner dependency

### Surprises discovered
- `stigmer up server` was passing `serverOnly: false` — same as `stigmer up` — never actually worked as documented
- `daemon.go` imported `agentrunner` package unconditionally even in server-only mode

## Session Progress (2026-05-20, Session 6)

### What was accomplished
- **T06a: SDK and client app runner cleanup**
  - Removed 47 runner references from `SessionComposer` (runnerId prop, showRunner, RunnerConfigPanel, WorkspaceRunnerSelector, runner imports from deleted `src/runner/`)
  - Removed `RunnerFileBrowser` import and runner props from `WorkspaceEditor`
  - Cleaned `useRecentWorkspaces` — renamed `runnerId` param to `scopeId`
  - Removed `"runner"` type from `ContextChip` and `RunnerIcon` from icons
  - Removed `runnerId` from `structural-share.ts` equality check
  - Removed `"runner"` case from `useDeleteResource` DeletableResourceKind
  - Cleaned stale `runnerId={flow.runnerId}` from both desktop and web `SessionLauncher`
  - Deleted web runner pages (`/runners`, `/runners/[id]`, `/settings/runners`), domain files, and sidebar link
  - Removed runner mock and runner validation tests from `useNewSessionFlow.test.tsx`
  - All `tsc --noEmit` clean across sdk/react, desktop, and web
  - All 475 SDK tests pass, 3 desktop tests pass

- **T06b: CLI activity routing flag**
  - Added `ActivityRouting` to `daemon.StartOptions`
  - Added `--activity-routing` flag to `stigmer up` and `stigmer up server`
  - Wired through to `STIGMER_ACTIVITY_ROUTING` env var in daemon process env
  - CLI `go build` clean

- **T06d: File browsing via native Tauri IPC**
  - Already complete: `onBrowseLocalFolder` via `useNativeFolderPicker` is the replacement
  - `WorkspaceEditor` now only shows Browse Folder when `onBrowseLocalFolder` is provided
  - No `RunnerFileBrowser` or runner-gated browsing remains

### Key changes
1. **`sdk/react/src/composer/SessionComposer.tsx`**: ~200 lines removed — runner imports, props, state, chips, config panel, `RunnerConfigPanel` component
2. **`sdk/react/src/workspace/WorkspaceEditor.tsx`**: RunnerFileBrowser import and drill-in removed, runner props removed, `canBrowse` simplified to `enableLocal`
3. **`sdk/react/src/workspace/useRecentWorkspaces.ts`**: `runnerId` → `scopeId` throughout
4. **`sdk/react/src/composer/ContextChip.tsx`**: `"runner"` type removed
5. **`sdk/react/src/composer/icons.tsx`**: `RunnerIcon` export deleted
6. **`sdk/react/src/internal/store/structural-share.ts`**: `runnerId` equality check removed
7. **`sdk/react/src/resource-detail/useDeleteResource.ts`**: `"runner"` case removed
8. **Client apps**: Both `SessionLauncher` files cleaned; web runner pages/routes/sidebar deleted
9. **CLI**: `--activity-routing` flag added to `stigmer up`, wired through daemon env

### Decisions made
- Runner vestiges in SDK were more extensive than T02 notes suggested — the SessionComposer, WorkspaceEditor, and web runner pages all survived the T02 deletion
- `useRecentWorkspaces` kept with `scopeId` parameter (preserves localStorage data compatibility)
- Web runner pages deleted entirely (no user-facing runner management in the new architecture)
- T06d effectively complete via existing `onBrowseLocalFolder`/`useNativeFolderPicker` pattern

### Surprises discovered
- Web app had full runner management pages (`/runners`, runner detail page, sidebar link) that were NOT cleaned in T02
- `useDeleteResource` in the SDK had a `"runner"` case calling `stigmer.runner.delete()` — would have been a runtime error
- `structural-share.ts` compared `runnerId` on execution status — stale since proto field was deleted

## Next Steps

1. ~~**TokenExchangeService**~~ — ✅ Complete (Session 12). Sandbox tokens replace forwarded user JWTs.
2. ~~**E2E testing**~~ — ✅ Done (Session 11 — test/integration-session-routing/)
3. ~~**E2E cloud testing**~~ — ✅ Done (Session 11 — cloud_control_plane_test.go, control plane level; full Daytona E2E deferred to cloud CI)
4. **Worker count scaling** — verify 20+ Workers in one process doesn't overload Temporal connection
5. **Sandbox orphan cleanup** — background job to clean up sandboxes whose sessions were deleted but cleanup step failed
6. **Fix ExecuteGraphton→ExecuteDeepAgent name mismatch** — Java workflow still dispatches `ExecuteGraphton` but unified runner registers `ExecuteDeepAgent`. Native harness per-session routing blocked until resolved.
7. **Token renewal mechanism** — if 4h TTL proves too short for continuous use, add runner-side token refresh (deferred from token exchange design)

## Session Progress (2026-05-20, Session 5)

### What was accomplished
- **Completed T05: Java control plane Runner domain refactor**
  - 203 files changed, 966 insertions, 42,771 deletions in stigmer-cloud
  - Proto stubs regenerated from OSS branch (Runner protos deleted, StreamingUsageSummary renamed)
  - Entire `domain/agentic/runner/` package deleted (31 Java files: handlers, repo, heartbeat, streams, launch tokens, launcher)
  - Downstream gRPC client deleted (`RunnerGrpcRepo`, `RunnerGrpcRepoImpl`)
  - MongoDB migration (`U20260421_RunnerIndexes`) deleted
  - FGA model (`runner.fga`) deleted, `can_create_runner` removed from organization
  - New `SessionDispatchService` replaces `RunnerDispatchService` — mirrors Go T04 implementation
  - `DispatchResult` simplified: removed `runnerId`, now `(taskQueue, harness)`
  - `AgentExecutionTemporalConfig` extended with `activityRouting` field + constants
  - `WorkflowExecutionDispatchService` simplified to global queue only (no provisioning)
  - `InvokeWorkflowExecutionWorkflowImpl` cleaned of `runner:` prefix detection
  - Removed Daytona SDK dependency from `MODULE.bazel`
  - Removed `application-runner-launcher.yaml` config and runner-launcher Spring profile
  - Cleaned kustomize overlays (local + prod) of runner-launcher env vars
  - 10 new unit tests for `SessionDispatchService`, all 60 Bazel tests pass

### Key changes
1. **Proto stubs**: All runner/v1 stubs deleted across Java, Go, Python, TypeScript, Dart. `RunnerUsageSummary` → `StreamingUsageSummary`. `runner_id` removed from Session/AgentExecution stubs.
2. **`SessionDispatchService.java`**: `STIGMER_ACTIVITY_ROUTING` env var (`global`/`session`), `formatSessionTaskQueue("session:" + id)`, loads session for harness extraction, global fallback
3. **`AgentExecutionCreateHandler`**: Uses `SessionDispatchService.resolve()` instead of `RunnerDispatchService.resolveOrProvision()`
4. **`AgentExecutionRecoverHandler`**: Same dispatch update
5. **`McpServerConnectHandler`**: Uses `SessionDispatchService.resolve(null)` — MCP connect always global
6. **`AgentExecutionUpdateStatusHandler`**: `runner_id` merge removed, `runnerUsage` → `streamingUsage`
7. **`WorkflowExecutionDispatchService`**: Reduced to single `resolve()` → global queue
8. **`InvokeWorkflowExecutionWorkflowImpl`**: `getActivityTaskQueue()` always appends `:wf-orch` suffix (no `runner:` prefix branching)
9. **`InvokeAgentExecutionWorkflowInput`**: `runnerId` field removed
10. **Build/config**: Daytona SDK removed, runner-launcher config deleted, FGA model cleaned, kustomize overlays stripped

### Decisions made
- Sandbox provisioning deferred (Option A from plan): cloud mode uses `global` routing with pre-deployed workers until `EnsureSessionSandbox` is designed as a follow-up
- `SessionDispatchService` is behaviorally identical to Go `ResolveActivityTaskQueue` — same env var, same queue naming, same fallback
- MCP connect always uses global queue (no session context) — matches OSS behavior
- Workflow executions stay on global queue (no session concept for workflows)
- `WorkflowDispatchResult` no longer has `hasRunner()` branching — suffix always appended

### Surprises discovered
- The `ProtoFgaSchemaConsistencyTest` still referenced deleted `runner.v1.CommandProto` and `runner.v1.QueryProto` descriptors — fixed by removing those entries
- The `AgentExecutionUpdateStatusHandler` had a log line referencing `hasRunnerUsage()` — updated to `hasStreamingUsage()`
- `InvokeWorkflowExecutionWorkflowImpl.getActivityTaskQueue()` had a `runner:` prefix detection branch to decide whether to append `:wf-orch` — now always appends since all queues are either global or `session:` prefixed

## Session Progress (2026-05-20, Session 4)

### What was accomplished
- **Completed T04: Per-session task queue routing**
  - Added `STIGMER_ACTIVITY_ROUTING` env var (values: `global`, `session`)
  - Implemented `FormatSessionTaskQueue(sessionID)` → `"session:{session_id}"`
  - Refactored `ResolveActivityTaskQueue` to branch on routing mode with `*Config` parameter
  - Updated `AgentExecutionController` with `SetTemporalConfig` setter
  - Updated MCP `SetConnectDependencies` to accept `*Config` instead of `string`
  - Hoisted config creation in `server.go` for shared access
  - 12 unit tests covering both modes, fallback, harness extraction
  - Updated stale comments referencing old `runner:{id}` convention
  - Updated README.md with routing mode documentation

### Key changes
1. **`config.go`**: Added `ActivityRouting` field, `RoutingGlobal`/`RoutingSession` constants, `STIGMER_ACTIVITY_ROUTING` env var
2. **`dispatch.go`**: `FormatSessionTaskQueue` pure function, `resolveTaskQueue` helper, refactored `ResolveActivityTaskQueue` with `*Config` param
3. **`dispatch_test.go`**: 12 tests — global mode, session mode, fallback, pure function
4. **`create.go`** + **`agentexecution_controller.go`**: Thread `temporalConfig` into `startWorkflowStep`
5. **`mcpserver_controller.go`** + **`connect.go`**: Replace `runnerQueue string` with `*Config`, use `temporalConfig.RunnerQueue`
6. **`server.go`**: Hoist config, wire to both controllers, add routing mode to log output

### Decisions made
- Queue naming: `session:{session_id}` (colon separator, matches Go workflow-runner suffix convention)
- Routing mode is server-level (env var), not per-session (no proto change needed)
- MCP connect always routes to global queue (discovery is not session-scoped)
- `FormatSessionTaskQueue` is exported for use by tests, integration harness, and cloud provisioning
- Config hoisted outside Temporal connection block (routing mode doesn't depend on connection)

### Surprises discovered
- MCP connect has no session ID in its request — it operates at the MCP server level. Per-session routing for MCP tool invocation is already handled by the execution workflow's activity routing during runtime, not by the connect flow.
- The `workflowinstance_controller_test.go` has a pre-existing failure (proto validation regex for task names) — unrelated to T04.

## Session Progress (2026-05-20, Session 3)

### What was accomplished
- **Completed T03: Scaffold `createStigmerRunner()` factory**
  - Created `src/runner.ts` with `createStigmerRunner()`, `StigmerRunnerOptions`, `StigmerRunner`
  - Created `src/index.ts` public API barrel
  - Slimmed `main.ts` from 124 lines to 75 lines (thin CLI entry delegating to factory)
  - Updated `package.json` with dual exports (`.` for library, `./cli` for binary)
  - Fixed activity registration gap: `RunScript`, `RunShell`, `CallLlm` now registered
  - 9 new tests, all passing. `tsc --noEmit` clean. 1367/1368 tests pass (1 pre-existing failure)

### Key changes
1. **`src/runner.ts`** (~250 lines): Factory with typed options, internal fetch interceptor handling, `Promise.all` activity imports, `Config` mapping, Temporal worker creation, `{start, shutdown}` handle
2. **`src/index.ts`** (~20 lines): Public API barrel re-exporting factory + types
3. **`src/main.ts`** (75 lines, down from 124): Thin CLI entry — `loadConfig()` → map to options → `createStigmerRunner()` → signal handlers → `runner.start()`
4. **`package.json`**: `main` → `./src/index.ts`, dual `exports` (`.` + `./cli`), updated `publishConfig`
5. **Bug fix**: 3 missing activity registrations (`RunScript`, `RunShell`, `CallLlm`)

### Decisions made
- `StigmerRunnerOptions` does NOT expose `mode` — derived from `proxyEndpoint` presence
- OTel is NOT part of the factory — consumer responsibility (avoids global state mutation)
- Fetch interceptor handled internally by the factory (not a two-step setup)
- `Config` interface unchanged — factory maps `StigmerRunnerOptions` → `Config` via private function
- `idleTimeoutSeconds` set to `null` in factory (not exposed — was unused anyway)

### Surprises discovered
- `RunScript`/`RunShell` (from `run-command.ts`) and `CallLlm` (from `call-llm.ts`) were implemented but never registered in `main.ts` — the workflow-runner-typescript-rewrite added these activities and wired `proxyActivities` for them, but forgot to add the factories to `main.ts`. Fixed in the factory.
- `idle-watchdog.ts` is just activity concurrency tracking (`activityStarted`/`activityFinished`), not process idle shutdown as the T01 plan assumed. No changes needed.
- `call-function.test.ts` has a pre-existing failure (stale assertion expecting "Phase 4b" in error message — the message changed when call:agent was implemented). Not related to T03.

## Session Progress (2026-05-20, Session 2)

### What was accomplished
- **Completed T02: Full Runner API removal from the OSS repo**
  - 463 files changed, 70,356 lines deleted, 3,621 lines inserted
  - 7 phased commits executed (proto deletion → Go server → dispatch → TS runner → SDK/React → CLI → desktop)
  - All builds verified: `buf lint`, Go (`stigmer-server`, `workflow-runner`, CLI), TypeScript (`runner` service)
  - All dispatch tests pass with simplified routing

### Key changes
1. **Proto deletion**: 6 runner proto files deleted, `RunnerUsageSummary` renamed to `StreamingUsageSummary`, `runner = 46` enum removed from `api_resource_kind.proto`, `runner_id` removed from session and execution protos
2. **Go server**: Entire `pkg/domain/runner/` package deleted (19 files), session `resolve_runner.go` deleted, dispatch simplified to hardcoded `agent_execution_runner` queue, `WaitForRunnerReady` activity deleted
3. **TS runner**: `heartbeat.ts` deleted, `runnerId` removed from config, heartbeat boot removed from `main.ts`
4. **SDK/React**: Runner hooks/components deleted (17 files), `useNewSessionFlow` cleaned of runner selection, usage type renamed
5. **CLI**: Runner command package deleted (18 files), `stigmer up` simplified to start server directly, `stigmer down runner`/`stigmer list runners` removed
6. **Desktop**: Runner pages, hooks, deep link handler, Tauri IPC commands, sidecar all deleted (19 files deleted, 6 modified)
7. **Workflow-runner**: Heartbeat package deleted, `STIGMER_RUNNER_ID` removed from config

### Decisions made
- `RunnerUsageSummary` → `StreamingUsageSummary` (not `ExecutionUsageSummary` due to collision with existing message in `io.proto`)
- No `reserved` directive on deleted enum value 46 — clean break
- Dispatch temporarily uses hardcoded `agent_execution_runner` queue — T04 replaces with per-session routing
- `stigmer up` now starts the server (no runner start concept)

## Next Steps

1. **T06: Desktop app refactor** — embed runner with per-session workers, set `STIGMER_ACTIVITY_ROUTING=session` on embedded server, remove Runner UI/launch tokens (depends on T04 ✅)
2. **Cloud sandbox provisioning** — design `EnsureSessionSandbox` Temporal activity to replace the deleted `DaytonaSandboxRunnerLauncher` (deferred from T05)

## Context for Resume

- Branch: `feat/unified-runner-migration` (both repos)
- T06c files:
  - `apis/ai/stigmer/agentic/session/v1/enum.proto` — `ExecutionTarget` enum
  - `backend/services/runner/src/runner-manager.ts` — `createStigmerRunnerManager()`
  - `backend/services/runner/src/main.ts` — IPC manager mode
  - `client-apps/desktop/src-tauri/src/runner.rs` — Tauri IPC commands
  - `client-apps/desktop/src/hooks/useEmbeddedRunner.ts` + `EmbeddedRunnerContext.tsx`
  - `backend/services/stigmer-server/.../dispatch.go` — `ExecutionTarget` in DispatchResult
  - `client-apps/cli/internal/cli/daemon/daemon_process.go` — single unified runner
- Key env vars:
  - `STIGMER_RUNNER_MODE=manager` — enables IPC protocol in runner
  - `STIGMER_ACTIVITY_ROUTING=global|session` (default: `global`)
  - `STIGMER_DEFAULT_EXECUTION_TARGET=local|cloud` (default: `local` for OSS, `cloud` for managed)
  - `STIGMER_RUNNER_NODE_BIN`, `STIGMER_RUNNER_APP_DIR`, `STIGMER_RUNNER_ENTRY_ARGS` — daemon runner config
- All builds pass: Go, TypeScript (runner + desktop), Rust (Tauri), Java (Bazel)
- Research report: `_projects/2026-05/20260518.01.unified-runner-migration/research.control-plane-runner-architecture-review/04.report.gemini.md`

## Quick Commands

After loading context:
- "Start T06 — Desktop app embedded runner" - Begin desktop integration
- "Design EnsureSessionSandbox activity" - Cloud sandbox provisioning follow-up
- "Show project status" - Get overview of progress
- "Commit and push" - Commit changes

---

*This file provides direct paths to all project resources for quick context loading.*
