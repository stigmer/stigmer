# App-Level Execution Target Across All SDKs

**Date**: May 21, 2026

## Summary

Added app-level `executionTarget` configuration to all Stigmer SDKs (TypeScript, Go, Python, React) so that local vs cloud execution is an app-level decision, not a per-session choice. The desktop app now sets `executionTarget="local"` on `StigmerProvider` instead of passing it per-hook, and all React hooks inherit the target from context automatically.

## Problem Statement

The `ExecutionTarget` (local vs cloud) was accepted as a per-session field across all SDKs, but it is fundamentally an app-level / deployment-level decision. Workspace state, runner processes, and sandbox provisioning are all scoped to the application, not individual sessions. A customer could accidentally create sessions with different targets in the same process, which is architecturally wrong.

### Pain Points

- No client-level default for `executionTarget` in any SDK
- React hooks accepted `executionTarget` as a per-hook option rather than inheriting from provider context
- Desktop app hardcoded `executionTarget: "local"` in `SessionLauncher` instead of setting it at the app level
- Customers building their own apps had to pass `executionTarget` to every session creation call

## Solution

Introduced app-level execution target configuration at each SDK layer, following each SDK's established patterns:

- **TypeScript SDK**: `StigmerConfig.executionTarget` on the client constructor
- **Go SDK**: `WithExecutionTarget()` client option
- **Python SDK**: `execution_target` constructor parameter on `StigmerClient`
- **React SDK**: `executionTarget` prop on `StigmerProvider` + `ExecutionTargetContext`

## Implementation Details

### TypeScript SDK (`@stigmer/sdk`)
- Added `executionTarget?: "local" | "cloud"` to `StigmerConfig`
- `Stigmer` class stores it as `defaultExecutionTarget` and wraps `session.create()` / `session.apply()` to inject the default when the per-call input is unspecified

### Go SDK
- Added `WithExecutionTarget(target)` to `ClientOption` pattern
- `Client.DefaultExecutionTarget` field stores the configured value
- `Client.ApplyDefaultExecutionTarget(input)` convenience method for callers

### Python SDK
- Added `execution_target: "local" | "cloud" | None` to `StigmerClient.__init__()`
- Stored as `default_execution_target` (int enum value) for callers to read

### React SDK (`@stigmer/react`)
- New `ExecutionTargetContext` + `useExecutionTarget()` hook (mirrors `DeploymentModeContext` pattern)
- `StigmerProvider` accepts `executionTarget` prop, distributes via context
- `useCreateSession` reads from context as fallback when per-call input omits it
- `useNewSessionFlow` reads from context; per-hook option deprecated with guidance to use provider

### Desktop App
- `App.tsx`: Added `executionTarget="local"` to `StigmerProvider`
- `SessionLauncher.tsx`: Removed hardcoded `executionTarget: "local"` from `useNewSessionFlow` -- now inherited from provider context

## Benefits

- Execution target is configured once at the app level, not per-session
- All sessions within an app automatically inherit the correct target
- Customers cannot accidentally mix local and cloud sessions in one app
- Desktop app follows the same pattern as customer apps
- Backward compatible -- per-call overrides still work for edge cases

## Impact

- **SDK consumers**: Can now set execution target at client construction time
- **React SDK consumers**: Set on `StigmerProvider`, all hooks inherit automatically
- **Desktop app**: Cleaner architecture, no per-component execution target wiring
- **No breaking changes**: All new fields are optional with no default change

## Related Work

- Unified Runner Migration (20260518.01)
- Runner Architecture Simplification (20260520.01)
- Cloud Workflow Sandbox Affinity (20260521.02)

---

**Status**: Production Ready
**Files Changed**: 12 (11 modified, 1 new)
