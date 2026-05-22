# Wire execution_target into Session Creation Flow

**Date**: May 21, 2026

## Summary

Wired the `execution_target` proto field through the React SDK session creation flow so clients can declare where session activities execute. Desktop sets `LOCAL` (it has an embedded runner), web leaves `UNSPECIFIED` (server decides). Added server-side immutability guards in both Go and Java to prevent `execution_target` changes after the first execution completes.

## Problem Statement

The `ExecutionTarget` enum (`LOCAL` / `CLOUD` / `UNSPECIFIED`) and the `SessionSpec.execution_target` field (field 12) were added in T06c, and the Go dispatch logic already reads and resolves the field. However, nothing in the React SDK or client apps actually *set* the field when creating a session. The desktop app starts an embedded runner and calls `addSession()` post-creation, but never tells the server "this session should route to my local runner." The field was always `UNSPECIFIED`.

### Pain Points

- Desktop sessions relied entirely on server defaults and post-hoc runner registration instead of declaring execution intent at creation time
- No server-side enforcement of `execution_target` immutability — the proto documented it as immutable after first execution, but the server didn't enforce it
- `buildUpdateInput` in `useSessionConversation` silently dropped `executionTarget` (and `cursorMode`) during session follow-up updates

## Solution

Thread `executionTarget` through the SDK layer as a configuration value (not managed state), wire it into both client apps, and add immutability guards on both server editions.

## Implementation Details

### SDK Layer (6 files modified, 1 new)

- **New `execution-target.ts`** — `ExecutionTargetOption` type (`"local"` | `"cloud"`), `toProtoExecutionTarget()` and `fromProtoExecutionTarget()` converters, paralleling the existing `HarnessOption` / `toProtoHarness` pattern
- **`useCreateSession`** — Added `executionTarget?: ExecutionTargetOption` to `SharedSessionFields`, mapped through `toProtoExecutionTarget` into `stigmer.session.create()`
- **`useNewSessionFlow`** — Added `executionTarget?: ExecutionTargetOption` to `UseNewSessionFlowOptions` as a configuration value (not `useState` — it's environment-determined, not user-toggled)
- **`useSessionPageFlow`** — Exposed `executionTarget` as a read-only derived value (like `harness`) for future UI badge display
- **`useSessionConversation`** — Fixed `buildUpdateInput()` to preserve `executionTarget` and `cursorMode` during session updates (both were silently dropped)
- **Barrel exports** — `ExecutionTargetOption`, `toProtoExecutionTarget`, `fromProtoExecutionTarget` exported from `@stigmer/react`

### Client App Wiring (1 file modified)

- **Desktop `SessionLauncher`** — Passes `executionTarget: "local"` to `useNewSessionFlow()`
- **Web `SessionLauncher`** — No changes needed (omitting `executionTarget` = `UNSPECIFIED` = server decides)

### Go Server Immutability Guard (2 files modified, 1 new)

- **New `validate_execution_target_immutability.go`** — `ValidateExecutionTargetImmutabilityStep` mirrors the harness guard: rejects `execution_target` changes when `harness_state_id` is non-empty; treats `UNSPECIFIED` as `LOCAL` for comparison
- **`update.go`** — Registered the new step in `buildUpdatePipeline()` after the harness guard

### Java Cloud Immutability Guard (1 file modified, 1 new)

- **`SessionUpdateHandler.java`** — Added `ValidateExecutionTargetImmutabilityStep` nested class with identical logic to the harness guard, registered in the update pipeline
- **New `SessionUpdateExecutionTargetImmutabilityTest.java`** — 5 unit tests covering: change before execution, rejection after execution, same target allowed, UNSPECIFIED-as-LOCAL equivalence, null existing resource

### Tests (3 files modified)

- **`useNewSessionFlow.test.tsx`** — 2 tests: `executionTarget` passes through to `createSession`, default omits the field
- **`useCreateSession.test.tsx`** — 2 tests: `executionTarget` mapped to proto enum value, omitted when not provided
- **`session_controller_test.go`** — 4 tests: creation persists LOCAL, change rejected after first execution, change allowed before first execution, same target update allowed after first execution

## Benefits

- Sessions now explicitly declare their execution intent at creation time, making dispatch routing deterministic rather than relying on server defaults
- Server-side enforcement prevents accidental `execution_target` changes that could leave workspace state in an inconsistent state
- The surprise fix for `cursorMode` being silently dropped during session updates prevents a latent bug that would surface when Cursor cloud mode is used with follow-up messages

## Impact

- **Desktop app** — All new sessions created from the desktop app will have `execution_target=LOCAL` persisted on the session
- **Web console** — No change in behavior (UNSPECIFIED still resolved by server)
- **Platform builders** — New `executionTarget` option available on `useNewSessionFlow` and `useCreateSession` for SDK consumers who need to control dispatch routing
- **Both server editions** — Immutability guard active on session updates, preventing post-execution target changes

## Related Work

- T06c: Desktop-owned embedded runner with execution target routing (added the proto field and dispatch logic)
- Session proto field consolidation (harness_state_id rename, same session)
- Follow-up: Cloud sandbox provisioning (EnsureSessionSandbox activity)

---

**Status**: Production Ready
**Timeline**: Session 9 (May 21, 2026)
