# Add SDK Runner Action Hooks

**Date**: April 24, 2026

## Summary

Added three React hooks to `@stigmer/react`'s runner module — `useLaunchLocalRunner`, `useStopRunner`, and `useDeleteRunner` — completing the SDK action layer for runner lifecycle management. These hooks connect the browser-side triggering (launch token creation + `stigmer://` URL dispatch) and mutation operations (stop, delete) that the Settings > Runners CRUD page and platform builders need.

## Problem Statement

The runner module in `@stigmer/react` had only a data hook (`useRunnerList`) and styled components (`RunnerPicker`, `RunnerListPanel`). There was no way for a React consumer — whether the Stigmer Console or a platform builder's app — to trigger runner lifecycle operations: launching a local runner from the browser, stopping a runner, or deleting one.

### Pain Points

- No React hook to initiate the browser-to-desktop runner launch flow (T02's `createLaunchToken` + `stigmer://` URL)
- No React hook to stop a runner (T06's `runner.stop()` had no React wrapper)
- No React hook to delete a runner (needed for T08's Settings > Runners CRUD)
- Platform builders embedding runner management had to call raw SDK client methods with manual loading/error state

## Solution

Three focused hooks, each wrapping a single SDK client method with the established mutation hook pattern (`useCallback` + `is*` + `error: Error | null` + `clearError` + rethrow). Each is independently importable from `@stigmer/react`.

## Implementation Details

### `useLaunchLocalRunner` — behavior hook

Orchestrates the two-step browser launch initiation:
1. Calls `stigmer.runner.createLaunchToken({ org })` to mint a one-time 60s token
2. Constructs `stigmer://launch-runner?token={token}` and opens it via a configurable `openUrl` callback

The `openUrl` callback defaults to `window.location.href` assignment (standard custom URL scheme dispatch pattern used by Zoom, Slack, VS Code). Platform builders in non-browser environments (Electron, iframe, React Native) can override. The hook returns `{ url, expiresAt }` on success for display or diagnostics.

Does not attempt desktop detection or runner-appearance polling — those are consumer concerns (observable via `useRunnerList.refetch()`).

### `useStopRunner` — mutation hook

Wraps `stigmer.runner.stop()` with a typed `StopRunnerInput` (`{ runnerId, reason? }`). Resolves with the updated `Runner` resource so the UI can reflect the new phase without a separate refetch.

### `useDeleteRunner` — mutation hook

Wraps `stigmer.runner.delete(id)`. Resolves with the deleted `Runner` for confirmation display (toast, undo prompt).

### Barrel exports

Both `sdk/react/src/runner/index.ts` and `sdk/react/src/index.ts` updated to export all three hooks and their associated types (`UseLaunchLocalRunnerOptions`, `UseLaunchLocalRunnerReturn`, `LaunchLocalRunnerResult`, `StopRunnerInput`, `UseStopRunnerReturn`, `UseDeleteRunnerReturn`).

## Benefits

- Platform builders can manage runner lifecycle from React with `useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner` — no manual loading/error state management
- Configurable URL opening keeps the SDK environment-agnostic (DD-004 compliance)
- All hooks are independently importable — platform builders who only need stop/delete don't pull in launch logic
- Types flow from proto-generated schemas (`CreateLaunchTokenRequestSchema`, `RunnerStopInputSchema`), never hand-written duplicates (DD-007 compliance)
- Foundation for T08's Settings > Runners full CRUD page

## Impact

- **React SDK (`@stigmer/react`)**: Three new public API hooks in the runner module
- **Platform builders**: Can embed runner management (launch, stop, delete) in their own apps
- **Stigmer Console**: T08 can build the Settings > Runners CRUD page by composing these hooks with UI components
- **Desktop app flow**: The `useLaunchLocalRunner` hook completes the triggering side — Desktop T05's `useDeepLinkHandler` handles the receiving side

## Related Work

- T02: Server-side launch token endpoints (`createLaunchToken` / `exchangeLaunchToken`)
- T06: Runner stop via command stream (`runner.stop()` RPC)
- Desktop T05: `useDeepLinkHandler` — the receiving side of the `stigmer://` URL
- T08: Settings > Runners full CRUD (next task — consumes these hooks)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
