# Desktop-Owned Embedded Runner with Execution Target Routing

**Date**: May 20, 2026

## Summary

Implemented the complete T06c architecture: desktop app embeds a dynamic per-session runner via IPC, a new `ExecutionTarget` proto field routes sessions to LOCAL or CLOUD runners, and the CLI daemon is simplified to a single unified runner process. This enables the desktop to manage per-session Workers without server-side runner registration, while preserving the global-queue simplicity for CLI development.

## Problem Statement

After deleting the Runner API resource (T01-T05), the platform lacked the mechanism for:
1. **Multi-tenant isolation**: Desktop connecting to cloud Temporal cannot use a global queue — it would consume all users' activities
2. **Local vs cloud dispatch**: Server needs to know whether to route to a local runner or provision a cloud sandbox
3. **Session resume**: Binding must survive app restarts — `execution_target` persists on the session

### Pain Points

- No way for desktop to dynamically manage per-session Workers
- Server-level routing mode doesn't express per-session preferences
- CLI daemon still boots 3 separate runner processes (Python + Go + Node)
- `stigmer up server` was broken — never actually ran in server-only mode

## Solution

Seven-track implementation adding `ExecutionTarget` to the session proto, a dynamic RunnerManager API, an IPC protocol between desktop and runner, Tauri commands, React hooks, CLI simplification, and dispatch updates across Go and Java control planes.

## Implementation Details

### Track 0: Proto + Dispatch
- Added `ExecutionTarget` enum (UNSPECIFIED/LOCAL/CLOUD) to `enum.proto`
- Added `execution_target` field 12 to `SessionSpec`
- Codegen across Go, TypeScript, Python, Java, Dart SDKs
- Go `dispatch.go`: `resolveExecutionTarget()`, `DefaultExecutionTarget` config, `STIGMER_DEFAULT_EXECUTION_TARGET` env var
- Java `SessionDispatchService`: `resolveExecutionTarget()`, 3-field `DispatchResult` record
- Java proto stubs regenerated from OSS branch

### Track 1: RunnerManager API
- `src/runner-manager.ts` (~310 lines): `createStigmerRunnerManager()` factory
- One shared `NativeConnection`, shared activities, dynamic per-session Workers
- Idempotent `addSession`/`removeSession`, graceful pool `shutdown()`

### Track 2: IPC Protocol
- `STIGMER_RUNNER_MODE=manager` in `main.ts` enters manager mode
- Newline-delimited JSON: `addSession`, `removeSession`, `shutdown` → `ready`, `sessionAdded`, `sessionRemoved`, `error`, `shutdownComplete`
- Logs redirected to stderr; stdout reserved for protocol

### Track 3: Tauri Commands
- `src-tauri/src/runner.rs` (~260 lines): `start_runner`, `stop_runner`, `add_session`, `remove_session`, `runner_status`
- Spawns Node.js with `STIGMER_RUNNER_MODE=manager`, communicates via stdin/stdout pipes
- Background stderr forwarding to Tauri logs

### Track 4: React Integration
- `useEmbeddedRunner` hook: starts runner on mount, exposes `addSession`/`removeSession`
- `EmbeddedRunnerContext` provider: mounted in `App.tsx`
- `SessionLauncher`: calls `addSession(id)` in `onSessionCreated` callback

### Track 5: CLI Daemon Unification
- Replaced `workflow-runner` + `agent-runner` + `cursor-runner` with single `runner` component
- Removed Python bootstrap dependency (`agentrunner` import removed)
- `buildUnifiedRunnerEnv()` replaces 3 separate env builders
- Fallback to `STIGMER_CURSOR_RUNNER_*` env vars for migration compatibility

### Track 6: Fix `stigmer up server`
- Changed `newUpServerCommand` to pass `serverOnly: true` (was incorrectly `false`)
- Updated description: "Start the control plane only (no embedded runner)"

### Track 7: Tests
- 7 new Go tests for `resolveExecutionTarget` and execution target in dispatch results
- All 19 Go dispatch tests pass
- 1451/1452 runner tests pass (1 pre-existing failure)
- 10/10 Java dispatch tests pass

## Benefits

- **Desktop isolation**: Each session gets its own Temporal Worker — no cross-contamination
- **Simplified CLI**: One Node.js process instead of three (Python + Go + Node)
- **Explicit routing**: `execution_target` on session makes dispatch transparent
- **Resume-safe**: Session's execution target persists — app restart polls the right queue
- **Future-proof**: `EXECUTION_TARGET_CLOUD` path ready for sandbox provisioning

## Impact

| Component | Change |
|-----------|--------|
| Proto (session) | New enum + field (additive, non-breaking) |
| Go stigmer-server | Dispatch returns execution target |
| Java stigmer-service | Dispatch returns execution target |
| @stigmer/runner | New `createStigmerRunnerManager()` + IPC mode |
| Desktop (Tauri) | New runner.rs module with IPC commands |
| Desktop (React) | New hooks + context + session wiring |
| CLI daemon | Simplified from 3 runners to 1 |
| `stigmer up server` | Actually works now (serverOnly=true) |

## Related Work

- T01-T05: Runner API deletion (prerequisite — completed in earlier sessions)
- T04: Per-session task queue routing (`FormatSessionTaskQueue`)
- Future: `EnsureSessionSandbox` activity for CLOUD execution target

---

**Status**: ✅ Production Ready (local path); Cloud provisioning deferred
**Timeline**: ~2 hours (single session)
