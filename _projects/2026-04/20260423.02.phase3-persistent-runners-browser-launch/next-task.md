# Next Task: 20260423.02.phase3-persistent-runners-browser-launch

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Phase 3 — Persistent Runners + Browser Launch

**Description**: Phase 3 of agent-runner-as-resource. Enable browser-initiated local runner launch via `stigmer://` URL scheme, full CRUD on Settings > Runners page, Docker placement variant, and server-side launch token handshake.
**Goal**: A cloud user clicks "Launch Local Runner" in the web console, the browser hands off to the locally installed Stigmer CLI via `stigmer://`, the CLI registers as a runner, and executions route to the user's laptop. Settings > Runners page gets full CRUD. Docker placement is available.
**Tech Stack**: Java/Spring Boot (stigmer-service), Go (CLI), TypeScript/React (SDK + web), Python (agent-runner), Protobuf
**Components**: backend/services/stigmer-service, client-apps/cli, sdk/react, client-apps/web, apis/, backend/services/agent-runner

## Current State

- **Status**: T02 complete, T05 complete, T06 complete, T07 complete, T08 complete, T09 complete, Desktop T05 complete. All automated tasks done. Manual integration testing checklist below.
- **Last Session**: 2026-04-24 (Session 7) — T09 complete (Integration testing + build fixes)
- **Active Task**: None

## Scope Change: Desktop App is Primary `stigmer://` Handler

The Stigmer Desktop app (project 20260423.03, T05) now handles `stigmer://` URLs as the primary receiver. It registers the `stigmer://` scheme via Tauri's deep-link plugin, exchanges the launch token via the SDK, and starts a runner via its CLI sidecar. This changes T03 and T04 in this project:

- **T03 and T04 are deferred** — They provide a CLI-only fallback for users who install the CLI but not the desktop app. Still relevant but no longer on the critical path.
- **T07 (SDK hooks) is the next high-priority task** — It builds the *triggering* side: `useLaunchLocalRunner` constructs the `stigmer://` URL and opens it from the browser. The desktop app already handles the *receiving* side.
- **Critical path is now**: T02 (done) → Desktop T05 (done) → T07 (done) → T08 (done) → T09.

## Task Overview

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T01 | Design & task plan | **Complete** | None |
| T02 | Server-side launch token endpoints | **Complete** | None |
| T03 | CLI `stigmer://` URL scheme registration (Go) | Deferred (CLI-only fallback) | None |
| T04 | CLI URL handler — receive and launch (Go) | Deferred (CLI-only fallback) | T02, T03 |
| T05 | Docker placement (Go CLI) | **Complete** | None |
| T06 | Runner stop via command stream (Proto + all languages) | **Complete** | None |
| T07 | SDK runner action hooks (React) | **Complete** | T06, T02 |
| T08 | Web UI — Settings > Runners full CRUD | **Complete** | T07 |
| T09 | Integration testing | **Complete** | All |

## Session Progress (2026-04-24, Session 7)

### T09: Integration Testing + Build Fixes (completed)

Fixed two build-breaking issues across stigmer and stigmer-cloud, wrote 18 automated React SDK tests for the runner hook module, and documented a manual integration testing checklist.

#### Build Fix 1: Dead Java handler blocking all stigmer-cloud builds

`SessionUpdateSandboxIdHandler.java` imported `UpdateSessionSandboxIdRequest` and referenced `SessionCommandController.Method.updateSandboxId` — both removed during the April 2026 runner/Daytona cleanup. The Go and Python sides were cleaned up; the Java handler was missed. Since `stigmer_service_lib` uses `glob(["src/main/java/**/*.java"])`, this single dead file blocked all Java compilation including `LaunchTokenServiceTest` and `RunnerStopHandlerTest`.

**Fix**: Deleted `SessionUpdateSandboxIdHandler.java`. No replacement needed — `sandbox_id` on `SessionSpec` is deprecated; sandbox lifecycle moved to runner metadata labels.

#### Build Fix 2: `RunnerStopHandlerTest.java` compilation errors (3 issues)

The test file had three pre-existing issues preventing compilation:

1. **Stale proto type**: imported `CheckAuthorizationOutput` but the generated type is `CheckAuthorizationResult` (renamed during an earlier refactor).
2. **Stale `InterceptorContextHolder` API**: used `setContext()`/`clearContext()` which were removed when the class migrated to gRPC's `Context.Key` mechanism. Rewrote context setup to use `Context.current().withValue(InterceptorContextHolder.getContextKey(), ctx).attach()` with proper `detach()` in teardown.
3. **Checked exception**: `RunnerRepo.save()` throws `Exception`; Mockito's `verify(...).save()` requires the test method to declare `throws Exception`.
4. **Missing BUILD.bazel dep**: `//backend/libs/java/grpc/grpc-request` not listed in test deps for `InterceptorContextHolder`.
5. **Wrong Bazel rule**: `java_test` instead of `java_junit5_test` (inconsistent with all other test targets in the file).

#### Build Fix 3: Go Bazel BUILD.bazel incomplete for stop.go

`backend/services/stigmer-server/pkg/domain/runner/controller/BUILD.bazel` was missing both `stop.go` from `go_library.srcs` and `stop_test.go` from `go_test.srcs`. The stop functionality existed on disk but was invisible to Bazel — never compiled or tested in CI. Added both files plus the additional test deps: `//apis/stubs/go/.../apiresource`, `.../apiresourcekind`, `//backend/libs/go/store/sqlite`, `@org_golang_google_grpc//metadata`.

#### React SDK Runner Hook Tests (new)

Added 18 tests across 3 new test files in `sdk/react/src/runner/__tests__/`, following established Vitest + `@testing-library/react` + `happy-dom` patterns.

**`useLaunchLocalRunner.test.tsx`** (8 tests):
- Success: token creation, URL construction (`stigmer://launch-runner?token=...`), `openUrl` callback, returned `url` + `expiresAt`
- URL encoding of special characters in tokens
- Custom `openUrl` callback override
- Undefined `expiresAt` when server omits it
- Error: `createLaunchToken` rejection → `error` state + rethrow, `openUrl` not called
- Non-Error rejection values (string) → normalized to `Error`
- `clearError` resets to null
- Successful retry clears previous error

**`useStopRunner.test.tsx`** (5 tests):
- Success: proto message construction with `runnerId` + `reason`, returns updated `Runner`
- Default `reason` to empty string when omitted
- Error: rejection → `error` state + rethrow
- `clearError`
- Successful retry clears previous error

**`useDeleteRunner.test.tsx`** (5 tests):
- Success: calls `runner.delete(id)`, returns deleted `Runner`
- Error: rejection → `error` state + rethrow
- Non-Error rejection values
- `clearError`
- Successful retry clears previous error

#### Verification

- `npx vitest run` — 11 test files, **114 tests passed** (96 existing + 18 new)
- `bazel test //backend/services/stigmer-server/pkg/domain/runner/controller:controller_test` — **PASSED** (launch_token + stop)
- `bazel build //backend/services/stigmer-service:stigmer_service_lib` — **clean** (Java compiles after dead code removal)
- `bazel test //backend/services/stigmer-service:launch_token_service_test` — **PASSED**
- `bazel test //backend/services/stigmer-service:runner_stop_handler_test` — **PASSED**

#### Manual Integration Testing Checklist

The following flows require a running environment with multiple processes and real infrastructure. These cannot be automated without a Testcontainers or embedded-service harness (which does not exist in the codebase and would be a deliberate architectural investment).

- [ ] **stigmer:// URL flow (end-to-end)**: In the web console, click "Launch Local Runner" → token creation succeeds → browser navigates to `stigmer://launch-runner?token=...` → OS dispatches to Stigmer Desktop app → desktop exchanges token → CLI sidecar starts runner → runner appears as READY in the runners list within ~10 seconds
- [ ] **Runner stop from web UI**: On Settings > Runners, click ⋮ → Stop on a READY runner → inline confirmation appears → confirm → runner transitions to STOPPED → list auto-refreshes → runner shows STOPPED phase
- [ ] **Runner delete from web UI**: Click ⋮ → Delete on a STOPPED runner → inline confirmation → confirm → runner disappears from list
- [ ] **System-managed runner protection**: Verify that system-managed runners (label `stigmer.ai/system-managed: "true"`) show no ⋮ action menu
- [ ] **Docker runtime**: Run `stigmer up runner --runtime docker` → container starts → heartbeat appears → runner shows READY → stop via CLI or web UI → container removed
- [ ] **Docker custom image**: Run `stigmer up runner --runtime docker --image ghcr.io/stigmer/agent-runner:latest` → container uses specified image
- [ ] **Launch token expiry**: Create a launch token (via SDK or curl), wait >60 seconds, attempt exchange → should fail with NOT_FOUND
- [ ] **Launch token single-use**: Create a token, exchange it successfully, attempt a second exchange with the same token → should fail with NOT_FOUND
- [ ] **Cross-pod stop (cloud, multi-pod deployment)**: Stop a runner connected to a different pod → Redis routes command → runner stops gracefully
- [ ] **Offline runner stop**: Stop a runner that has disconnected (no active bidi stream) → should transition directly to STOPPED without stream interaction
- [ ] **Phase-based action visibility**: READY and BUSY runners show both Stop and Delete; STOPPED, FAILED, and PENDING runners show only Delete

## Session Progress (2026-04-24, Session 6)

### T08: Settings > Runners Full CRUD (completed)

Upgraded the read-only Settings > Runners page into a full management surface. `RunnerListPanel` in `@stigmer/react` now includes per-row Stop and Delete actions with inline confirmation, and `RunnersSection` in the Console gained a "Launch Local Runner" button wired to `useLaunchLocalRunner`.

#### Architectural Decisions (confirmed before implementation)

- **DD-T08-01: Per-row inline actions, not a detail panel** — Stop/Delete as per-row actions directly on `RunnerRow`. Runners have no editable fields; a detail panel would add a navigation step with no editing benefit. Follows `ApiKeyListPanel` precedent.
- **DD-T08-02: Inline confirmation, no modals** — Row transforms to destructive border/bg with confirm/cancel buttons. Only one confirmation active at a time across the list. Avoids portal/z-index issues for SDK embedders.
- **DD-T08-03: System-managed runners excluded from actions** — Auto-provisioned cloud runners show no action menu. Only the "System" badge. Users should not interfere with the platform's auto-scaling.
- **DD-T08-04: Launch button in RunnersSection, not RunnerListPanel** — "Launch Local Runner" is a page-level "create" analog in the section header (like "+ New OAuth app"). The SDK hook (`useLaunchLocalRunner`) is the integration point for platform builders.
- **DD-T08-05: Self-contained mutations inside RunnerListPanel** — `useStopRunner` and `useDeleteRunner` called per-row internally (like `ApiKeyListPanel`'s built-in delete). Optional `onStopped`/`onDeleted` notification callbacks for consumers.
- **DD-T08-06: Phase-based action visibility** — READY/BUSY: Stop + Delete. STOPPED/FAILED/PENDING: Delete only. System-managed: no actions.

#### SDK Changes (`sdk/react/src/runner/RunnerListPanel.tsx`)

- Added `onStopped?: (runner: Runner) => void` and `onDeleted?: (runner: Runner) => void` optional callback props.
- Added `confirming` state: `{ runnerId, action: "stop" | "delete" } | null` — single-confirmation-at-a-time across the list.
- Evolved `RunnerRow` with action menu (`ActionMenu` dropdown: `⋮` button → phase-appropriate items) and inline confirmation (`ConfirmationRow`).
- Each row calls `useStopRunner()` and `useDeleteRunner()` internally. After success: clear confirmation, auto-refetch, fire notification callback.
- Errors cleared when confirmation opens via `useEffect` on `confirmingAction` transition.
- Enhanced empty state copy to reference browser launch.
- New internal components: `ActionMenu`, `ConfirmationRow`, `MoreVerticalIcon`, `StopIcon`, `TrashIcon`, `SpinnerIcon`.

#### Console Changes (`client-apps/web/src/domain/settings/RunnersSection.tsx`)

- Added `useLaunchLocalRunner` hook from `@stigmer/react`.
- "Launch Local Runner" button in section header with `isLaunching` loading state and error feedback.
- Wired `onRefetchRef` on `RunnerListPanel` for post-launch list refresh.

#### Verification

- Zero linter errors. `tsc --noEmit` passes cleanly on the full `sdk/react` package.
- Zero Console imports in SDK (`@/`, `client-apps/`, `next/` — none found).
- Barrel exports unchanged — new props are optional additions to existing `RunnerListPanelProps`.
- Backward compatible — existing consumers unaffected (new props are optional).

## Session Progress (2026-04-24, Session 5)

### T07: SDK Runner Action Hooks (completed)

Added three React hooks to `@stigmer/react`'s runner module, providing the action layer that T08 (Settings > Runners CRUD) and platform builders need for runner lifecycle management from the browser.

#### Architectural Decisions (confirmed before implementation)

- **DD-T07-01: Three hooks, not one monolith** — `useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner` as separate single-responsibility hooks. Platform builders may need stop/delete without launch, or launch without CRUD. Composable hooks respect headless-first (DD-003).
- **DD-T07-02: Configurable URL opening** — `useLaunchLocalRunner` opens `stigmer://launch-runner?token=...` via a configurable `openUrl` callback (default: `window.location.href`). SDK portability (DD-004) — platform builders in Electron, iframe, or React Native can override.
- **DD-T07-03: No desktop detection / polling** — Hook reports success on token creation + URL open. Does not detect whether the desktop app received the URL or poll for runner appearance. Consumer uses `useRunnerList.refetch()` for observation.
- **DD-T07-04: Launch returns URL + expiry** — `launch()` resolves with `{ url, expiresAt }` so consumers can display, copy, or use for diagnostics.
- **DD-T07-05: Error handling follows toError convention** — All hooks use `toError` helper and `Error | null` pattern matching `useCreateSession`, `useDeleteOAuthApp`.

#### New Hooks

- **`useLaunchLocalRunner`** (`useLaunchLocalRunner.ts`) — Behavior hook. Calls `createLaunchToken({ org })`, constructs `stigmer://launch-runner?token={token}` URL, opens via `openUrl` callback. Returns `{ launch, isLaunching, error, clearError }`.
- **`useStopRunner`** (`useStopRunner.ts`) — Mutation hook. Wraps `runner.stop(input)` with `StopRunnerInput` accepting `{ runnerId, reason? }`. Returns `{ stop, isStopping, error, clearError }`.
- **`useDeleteRunner`** (`useDeleteRunner.ts`) — Mutation hook. Wraps `runner.delete(id)`. Returns `{ deleteRunner, isDeleting, error, clearError }`.

#### Barrel Exports

- `sdk/react/src/runner/index.ts` — Added exports for all three hooks and their types.
- `sdk/react/src/index.ts` — Added re-exports so platform builders import from `@stigmer/react`.

#### Verification

- Zero linter errors. `tsc --noEmit` passes cleanly on the full `sdk/react` package.
- All hooks follow established patterns from `useDeleteOAuthApp`, `useCreateSession`, etc.
- All types derived from proto-generated schemas (`CreateLaunchTokenRequestSchema`, `RunnerStopInputSchema`), never hand-written duplicates.

## Session Progress (2026-04-24, Session 4)

### T06: Runner Stop via Command Stream (completed)

Implemented server-initiated graceful runner stop as a dedicated `stop` RPC on `RunnerCommandController` with `can_edit` authorization. The stop command routes through the existing bidi command stream to connected runners, with a direct STOPPED transition fallback for offline runners. Fully idempotent. Implementations in Go (OSS), Java (Cloud), Go CLI daemon, and all SDKs (TypeScript, Go, Python, Java, Dart) via codegen.

#### Architectural Decisions (confirmed before implementation)

- **DD-T06-01: Dedicated `stop` RPC, not `sendCommand`** — Stop is a lifecycle mutation requiring `can_edit` authorization, not an operational query using `can_view`. A dedicated RPC gives proper `Runner` return type, cleaner API, and correct permission semantics. `RunnerSendCommandInput.command` stays unchanged.
- **DD-T06-02: Python agent-runner out of scope** — The Go CLI daemon owns the bidi stream and supervises the Python subprocess. When it receives a stop command, it SIGTERMs the Python child. Python's existing shutdown handler drains Temporal and exits. No Python changes needed.

#### Proto Changes

- **`io.proto`** — Added 3 new messages: `StopRunnerRequest` (reason), `StopRunnerResponse` (empty ack), `RunnerStopInput` (runner_id + reason). Extended `RunnerCommandRequest.command` oneof with `stop = 3` and `RunnerCommandResponse.result` with `stop = 4`.
- **`command.proto`** — Added `rpc stop(RunnerStopInput) returns (Runner)` with `can_edit` permission, `runner_id` field path.
- `buf lint` clean, `buf breaking` clean (purely additive).

#### Go Server (OSS)

- **`stop.go`** — `Stop()` handler: validates input, loads runner, idempotent for STOPPED/FAILED, routes via `StreamRegistry.SendCommand` if connected, else direct STOPPED transition with `stopped_at` timestamp.
- **`stop_test.go`** — 6 test cases: missing-id, not-found, already-stopped, failed, disconnected-transitions-to-stopped, connected-sends-command-and-returns. All pass.

#### Go CLI Daemon

- **`runner_stream_commands.go`** — Added `StopRunnerRequest` dispatch case returning `StopRunnerResponse` ack. Introduced `commandResult` struct pairing response with `stopRequested` flag. Added `handleStop()` function.
- **`runner_stream.go`** — Added `ErrServerRequestedStop` sentinel. `recvLoop` sends ack then returns the error. `streamLoop` sends graceful STOPPED heartbeat + CloseSend on stop error. `Run` exits without reconnecting.
- **`runner_stream_commands_test.go`** — 5 test cases: dispatch ack+signal, ListDirectory no-signal, unknown no-signal, recvLoop sends-ack-then-returns-stop-error, streamLoop full graceful shutdown sequence (READY heartbeat → stop ack → STOPPED heartbeat → CloseSend). All pass.

#### Java Server (Cloud)

- **`RunnerStopHandler.java`** — `OperationHandlerV2<RunnerStopInput, Runner>`. FGA `can_edit` authorization. Three routing paths: local stream, Redis cross-pod, direct STOPPED fallback. Follows `RunnerSendCommandHandler` pattern.
- **`RunnerStopHandlerTest.java`** — 7 test cases: not-found, already-stopped, failed, connected-locally, offline, FGA-denied, empty-runner-id. Build blocked by pre-existing `SessionUpdateSandboxIdHandler` compilation error (not T06-related).
- **`BUILD.bazel`** — Added `runner_stop_handler_test` target.

#### Codegen & SDK

- `make codegen` (stigmer) + `make protos` (stigmer-cloud) — All language stubs regenerated.
- TypeScript SDK: `RunnerClient.stop(input)` auto-generated.
- Go SDK: `RunnerClient.Stop(ctx, input)` auto-generated.
- Java/Python/Dart SDKs: stubs regenerated with stop support.

## Session Progress (2026-04-23, Session 3)

### T05: Docker Placement (completed)

Implemented `stigmer up runner --runtime docker` to run the agent-runner inside a Docker container instead of as a native Python process. All Docker interaction via `exec.Command` behind a clean `DockerClient` interface. Runtime type is a CLI-local concern — no proto changes, no server awareness.

#### Architectural Decisions (confirmed before implementation)

- **DD-T05-01: exec.Command, not Docker SDK** — All Docker operations (`run`, `stop`, `rm`, `inspect`) via `exec.Command("docker", ...)` wrapped behind a `DockerClient` interface. Avoids massive dependency tree, enables Podman/nerdctl compatibility for free.
- **DD-T05-02: CLI-local runtime type** — Runtime (`native` vs `docker`) is stored in the local state file only. The server sees an identical runner regardless of how it was started. Proto modeling deferred until user feedback.
- **DD-T05-03: State file extension** — `RunnerState` gains `Runtime` and `ContainerID` fields. Existing state files without these fields default to native (backward compatible via `omitempty`).
- **DD-T05-04: Container naming** — `stigmer-runner-<slug>` as the Docker container name.
- **DD-T05-05: Image default** — `ghcr.io/stigmer/agent-runner:<cli-version>`. `--image` flag overrides.

#### Code Changes

**New files:**
- `client-apps/cli/internal/cli/runner/docker.go` — `DockerClient` interface + `execDockerClient` implementation. Methods: `IsAvailable`, `Run`, `Inspect`, `Stop`, `Remove`, `Wait`, `Logs`. Plus `WaitUntilRunning` (polling health check), `IsContainerAlive` (liveness probe), `DefaultImage` (version-tagged image resolution). Single `runDockerCmd` helper captures stdout/stderr separately.
- `client-apps/cli/internal/cli/runner/docker_test.go` — 11 tests: mock-based `DockerClient` tests for `WaitUntilRunning`, `IsContainerAlive`, `DefaultImage`, `resolveRuntime`, `truncateID`.
- `client-apps/cli/internal/cli/runner/state_test.go` — 5 tests: `IsDocker()`, backward compatibility (old JSON without Runtime), Docker round-trip, native omits Docker fields, save/load Docker state.

**Modified files:**
- `client-apps/cli/internal/cli/runner/state.go` — Added `RuntimeNative`/`RuntimeDocker` constants, `Runtime` and `ContainerID` fields on `RunnerState`, `IsDocker()` method, `isRunnerAlive()` dispatcher. Updated `IsActive`, `ListActiveRunners`, `ListAllRunnerStates`, `ReapStaleRunners` to use runtime-aware liveness checks.
- `client-apps/cli/internal/cli/runner/start.go` — Added `Runtime`/`Image` to `StartOptions`. Extracted `registeredRunner` struct for shared registration phase. Refactored `Start()` into strategy dispatch: `startNativeRunner()` (existing Python path) and `startDockerRunner()` (new container lifecycle with health polling, bidi stream, signal-aware shutdown). Added `buildDockerEnv()` and `resolveRuntime()`.
- `client-apps/cli/internal/cli/runner/stop.go` — Split `StopRunner` into `stopNativeRunner` (SIGTERM/SIGKILL) and `stopDockerRunner` (docker stop + docker rm). Added `truncateID` for clean container ID display.
- `client-apps/cli/cmd/stigmer/root/up.go` — Added `--runtime` and `--image` flags to both `stigmer up` and `stigmer up runner`. Updated `handleUpRunner` to pass through. Added Docker examples to help text.

#### Tests

- 16 new tests: all pass. No new dependencies.
- Full CLI binary compiles cleanly.

## Session Progress (2026-04-23, Session 2)

### T02: Server-Side Launch Token Endpoints (completed)

Implemented the browser-to-CLI credential handshake via two new gRPC RPCs on `RunnerCommandController`, backed by opaque UUID tokens in Redis with 60s TTL.

#### Architectural Decisions (confirmed before implementation)

- **DD-T02-01: gRPC not REST** — Both RPCs added to the existing `RunnerCommandController` service, consistent with all other runner APIs. No new HTTP surface needed.
- **DD-T02-02: Opaque UUID in Redis, not JWT** — Token is a UUID stored in Redis with 60s TTL. Simpler than JWT+consumed-set: atomic single-use via `GETDEL`, natural multi-instance support, no signing key management for throwaway tokens.
- **DD-T02-03: Exchange returns credentials only** — The exchange endpoint is a pure token swap. Runner resource creation is the CLI's responsibility via the existing `apply` RPC. Separation of security and domain concerns.
- **DD-T02-04: Cloud-primary** — Proto defined in shared `apis/` (contract completeness). Java implementation in stigmer-cloud. Go server returns `UNIMPLEMENTED` with descriptive messages.
- **DD-T02-05: JWT minted at creation time** — The Stigmer JWT is minted during `createLaunchToken` (when the caller is authenticated) and stored alongside the opaque token in Redis. The exchange endpoint does zero DB access and zero JWT minting — it's a pure lookup+delete+return.

#### Proto Changes

- **`io.proto`** — Added 4 new messages: `CreateLaunchTokenRequest` (org), `CreateLaunchTokenResponse` (token, expires_at), `ExchangeLaunchTokenRequest` (token), `ExchangeLaunchTokenResponse` (access_token, token_type, expires_in, org). Response shape mirrors `MintUserTokenResponse` for credential consistency.
- **`command.proto`** — Added 2 new RPCs to `RunnerCommandController`: `createLaunchToken` (FGA-authorized: `can_create_runner` on org) and `exchangeLaunchToken` (`is_public = true` — the one-time token IS the proof of authorization).
- **Validation**: `buf lint` clean, `buf breaking` clean (purely additive changes).

#### Java Implementation (stigmer-cloud)

All files under `domain/agentic/runner/launch/`:

- **`LaunchTokenService.java`** — Core token lifecycle. Creates: resolves caller claims from interceptor context (decodes Auth0 JWT for email/name), mints Stigmer JWT via `StigmerJwtIssuer`, stores in Redis (`launch-token:{uuid}` with 60s TTL). Exchanges: atomic `GETDEL`, returns stored credentials. Token masking in logs.
- **`RunnerCreateLaunchTokenHandler.java`** — Authenticated handler. Extracts caller from `InterceptorContextHolder`, delegates to `LaunchTokenService.create()`. Follows `OperationHandlerV2` pattern (same as `RunnerSendCommandHandler`).
- **`RunnerExchangeLaunchTokenHandler.java`** — Public handler (`is_public`). Zero auth deps, zero domain deps, zero DB deps. Validates input, delegates to `LaunchTokenService.exchange()`.

#### Go Stub (stigmer OSS)

- **`launch_token.go`** — Both RPCs return `codes.Unimplemented` with descriptive messages ("launch tokens are not supported in OSS mode — use 'stigmer login' to authenticate the CLI directly").

#### Tests

- **`LaunchTokenServiceTest.java`** — 7 test cases: successful create (JWT mint + Redis store + TTL), JWT signing failure (INTERNAL), successful exchange, expired token (NOT_FOUND), consumed token (NOT_FOUND), corrupted Redis value (INTERNAL), create+exchange roundtrip.
- **`launch_token_test.go`** — 2 test cases: both RPCs return UNIMPLEMENTED. **Passes**.
- **Note**: Java test cannot run due to pre-existing `SessionUpdateSandboxIdHandler` compilation error (references `UpdateSessionSandboxIdRequest` which doesn't exist in proto). This is not caused by our changes — the `stigmer_service_lib` target was already broken.

#### Codegen

- `make codegen` in stigmer — Go, TS, Python, Dart stubs regenerated
- `make protos` in stigmer-cloud — Java, Go, Python, TS, Dart stubs regenerated

### Surprises Discovered

1. `RequestCallerIdentity` from the interceptor context does NOT carry email, name, or org — only `identityAccountId`, `idpId`, and the raw `accessToken` (JWT). For email/name, we decode the caller's existing JWT (already verified by the auth chain) using `com.auth0.jwt.JWT.decode()`.
2. `platformClientId` is null for browser (Auth0) users — the `StigmerJwtIssuer` accepts null for this claim. The minted JWT simply omits the claim, which is fine since the verifier only checks issuer and signature.
3. Pre-existing build breakage in `SessionUpdateSandboxIdHandler.java` blocks all Java compilation in stigmer-cloud. Not caused by T02.

## What already exists (from prior projects)

- **AgentRunner** proto, Java aggregate, Go controller, heartbeat, dispatch, RunnerLauncher — all exist
- **`stigmer up runner`** CLI command with multi-runner management, slug naming, state persistence
- **Runner picker** in session composer (`RunnerPicker.tsx`, `useRunnerList.ts`)
- **Settings > Runners** page (full CRUD: `RunnerListPanel.tsx` with Stop/Delete actions, `RunnersSection.tsx` with Launch Local Runner button)
- **Bidi command stream** from runner to server + `sendCommand` API (Go + Java)
- **Session auto-bind** and dispatch routing to chosen runner
- **Side-Channel Proxy** code complete (pending deploy — NOT a blocker for this project)

## The `stigmer://` Flow (centrepiece)

Primary path (Desktop app installed):

```
Browser                          OS                    Desktop App (Tauri)
  │                               │                         │
  │ createLaunchToken({ org })    │                         │
  │──────────────────────►        │                         │
  │ ◄─── { token, expiresAt }    │                         │
  │                               │                         │
  │ Navigate to                   │                         │
  │ stigmer://launch-runner?      │                         │
  │   token=<token>               │                         │
  │──────────────────────────────►│                         │
  │                               │ Deep link dispatch      │
  │                               │────────────────────────►│
  │                               │                         │
  │                               │  exchangeLaunchToken()  │
  │                               │  ◄── { accessToken }    │
  │                               │                         │
  │                               │  invokeStartRunner()    │
  │                               │  (CLI sidecar:          │
  │                               │   stigmer up runner     │
  │                               │   --token <jwt>)        │
  │                               │  heartbeat → Ready      │
  │                               │                         │
  │ Poll: runner appeared as Ready│                         │
  │◄──────────────────────────────│                         │
```

Fallback path (CLI only, no desktop — deferred T03/T04): same flow but the OS dispatches to the CLI binary instead.

## Related Projects

- **20260420.01.agent-runner-as-resource** — Phase 0-2 (code complete). This project is Phase 3.
- **20260422.01.runner-ux-cli-restructure** — CLI and UI runner foundations (complete).
- **20260422.02.runner-command-stream** — Bidi stream + sendCommand (T02-T07 complete, T08 pending).
- **20260423.03.stigmer-desktop-app** — Companion project. Desktop app T05 (complete) is the primary `stigmer://` handler.

## Context for Resume

- Both stigmer and stigmer-cloud repos are on `feat/secrets-vault-migration` branch
- Phase 0 deploy (proxy to staging) is a separate ops task — not a blocker here
- All Phase 3 work is about local/persistent runners which use their own credentials
- The SDK runner module (`sdk/react/src/runner/`) already has: useRunnerList, RunnerPicker, RunnerListPanel, phase.ts
- The TypeScript SDK already has RunnerClient with list/create/delete methods
- T02 launch token proto: `createLaunchToken` (authenticated, FGA `can_create_runner`) and `exchangeLaunchToken` (`is_public`) on `RunnerCommandController`
- T02 launch token storage: Redis key `launch-token:{uuid}` with 60s TTL, atomic `GETDEL` on exchange
- T02 credential flow: Stigmer JWT minted at creation time (not exchange time), stored in Redis alongside token, exchange is pure lookup+delete+return
- T02 claim resolution: email/name decoded from caller's Auth0 JWT via `JWT.decode()`, identityAccountId from interceptor context, org from request
- T02 Java files: `domain/agentic/runner/launch/` — `LaunchTokenService.java`, `RunnerCreateLaunchTokenHandler.java`, `RunnerExchangeLaunchTokenHandler.java`
- T02 Go stub: `backend/services/stigmer-server/pkg/domain/runner/controller/launch_token.go` — UNIMPLEMENTED
- T02 generated TS SDK: `RunnerClient` now has `createLaunchToken()` and `exchangeLaunchToken()` methods (auto-generated from proto)
- Desktop T05 complete: `useDeepLinkHandler` hook in `client-apps/desktop/src/hooks/useDeepLinkHandler.ts` handles `stigmer://launch-runner?token=...` URLs, exchanges the token, and starts a runner via the CLI sidecar
- Desktop uses `tauri-plugin-deep-link` + `tauri-plugin-single-instance` (with `deep-link` feature) for URL scheme handling
- T03/T04 deferred: CLI-only fallback for users without the desktop app
- T05 Docker placement: `DockerClient` interface in `docker.go`, runtime dispatch in `start.go`, `--runtime`/`--image` flags in `up.go`, container lifecycle in `stop.go`, `Runtime`/`ContainerID` fields in `state.go`
- T05 uses `exec.Command("docker", ...)` — no Docker SDK dependency. Compatible with Podman/nerdctl.
- T05 container naming: `stigmer-runner-<slug>`. Default image: `ghcr.io/stigmer/agent-runner:<cli-version>`.
- T06 stop RPC: `rpc stop(RunnerStopInput) returns (Runner)` with `can_edit` on `RunnerCommandController`. Separate from `sendCommand` — different permission, different return type, different intent.
- T06 stream protocol: `RunnerCommandRequest.command.stop` (field 3) and `RunnerCommandResponse.result.stop` (field 4). Reuses `StreamRegistry.SendCommand` for correlation.
- T06 Go server: `stop.go` — connected path (stream), offline path (direct STOPPED), idempotent for STOPPED/FAILED
- T06 Go CLI: `ErrServerRequestedStop` sentinel triggers graceful shutdown (STOPPED heartbeat + CloseSend) and prevents reconnection
- T06 Java: `RunnerStopHandler.java` — FGA `can_edit`, local stream / Redis cross-pod / direct fallback
- T06 SDK: `stigmer.runner.stop(input)` is the foundation for T07's `useStopRunner()` React hook
- T07 hooks: `useLaunchLocalRunner` (behavior, browser launch trigger), `useStopRunner` (mutation), `useDeleteRunner` (mutation) in `sdk/react/src/runner/`
- T07 `useLaunchLocalRunner` calls `createLaunchToken({ org })`, constructs `stigmer://launch-runner?token={token}`, opens via configurable `openUrl` callback (default `window.location.href`)
- T07 `useStopRunner` wraps `runner.stop()` with `StopRunnerInput { runnerId, reason? }`, resolves with updated `Runner`
- T07 `useDeleteRunner` wraps `runner.delete(id)`, resolves with deleted `Runner`
- T07 all hooks follow established mutation pattern: `useCallback` + `is*` boolean + `error: Error | null` + `clearError` + rethrow
- T07 barrel exports updated in `sdk/react/src/runner/index.ts` and `sdk/react/src/index.ts`
- T07 no proto changes, no backend changes, no codegen — purely React SDK layer
- T08 `RunnerListPanel` now has per-row `ActionMenu` (⋮ dropdown → Stop/Delete) + `ConfirmationRow` (inline destructive confirmation)
- T08 `confirming` state at panel level: `{ runnerId, action: "stop" | "delete" } | null` — only one confirmation at a time
- T08 each `RunnerRow` calls `useStopRunner()` and `useDeleteRunner()` internally, matching `ApiKeyListPanel` pattern
- T08 system-managed runners (label `stigmer.ai/system-managed: "true"`) show no action menu
- T08 phase-based action visibility: READY/BUSY → Stop + Delete; STOPPED/FAILED/PENDING → Delete only
- T08 `RunnerListPanelProps` gained optional `onStopped` and `onDeleted` notification callbacks — no breaking changes
- T08 `RunnersSection` uses `useLaunchLocalRunner` with `isLaunching` loading state + `error` feedback
- T08 "Launch Local Runner" button in section header (Console), matching "+ New OAuth app" CTA pattern
- T08 no proto changes, no backend changes, no codegen — purely SDK React + Console layer
- T09 deleted `SessionUpdateSandboxIdHandler.java` (dead code, proto RPC removed) — unblocked all stigmer-cloud Java builds
- T09 fixed `RunnerStopHandlerTest.java`: `CheckAuthorizationOutput` → `CheckAuthorizationResult`, `InterceptorContextHolder` API migration to gRPC `Context.Key`, `throws Exception` on verify, added `grpc-request` dep, changed to `java_junit5_test`
- T09 fixed `runner/controller/BUILD.bazel`: added `stop.go` to library srcs, `stop_test.go` to test srcs with correct deps
- T09 React SDK runner tests: 18 tests in `sdk/react/src/runner/__tests__/` — `useLaunchLocalRunner.test.tsx` (8), `useStopRunner.test.tsx` (5), `useDeleteRunner.test.tsx` (5)
- T09 full test suite: 114 Vitest tests pass, Go `controller_test` passes, Java `launch_token_service_test` + `runner_stop_handler_test` pass

## Blockers

None. All automated tasks complete. Manual integration testing checklist in Session 7 notes above.

## Quick Commands

- "Show project status" — Get overview of progress
- "Run manual checklist" — Review the manual integration testing items from T09

---

*This file provides direct paths to all project resources for quick context loading.*
