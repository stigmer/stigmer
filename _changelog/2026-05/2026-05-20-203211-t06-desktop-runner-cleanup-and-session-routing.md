# T06: Desktop App Runner Cleanup and Session Routing

**Date**: May 20, 2026

## Summary

Completed the first phase of the desktop app refactor (T06a/b/d) for the runner architecture simplification. Removed all Runner API vestiges from the SDK, web console, and desktop app — cleaning 832 lines of dead code and broken imports left from the T02 proto deletion. Added `--activity-routing` flag to `stigmer up` for per-session Temporal task queue routing. File browsing now uses native Tauri IPC exclusively.

## Problem Statement

The T02 Runner API deletion removed the proto definitions, Go server domain, and SDK runner module (`sdk/react/src/runner/`), but left behind significant consumer code that referenced the deleted modules — creating broken imports, dead UI, and stale test assertions.

### Pain Points

- `SessionComposer` had 47 runner references: `runnerId` prop, runner selector UI, `RunnerConfigPanel` component, imports from deleted `src/runner/` module
- `WorkspaceEditor` imported the deleted `RunnerFileBrowser` and had runner-gated file browsing
- Web console had full runner management pages (`/runners`, runner detail) with broken SDK imports
- `useDeleteResource` had a `"runner"` case calling `stigmer.runner.delete()` — would crash at runtime
- `structural-share.ts` compared `runnerId` on execution status protos where the field no longer exists
- Both `SessionLauncher` files passed `flow.runnerId` / `flow.setRunnerId` to a hook that no longer returns those properties
- No CLI mechanism to set `STIGMER_ACTIVITY_ROUTING` for desktop/embedded use

## Solution

Systematic removal of all Runner API consumer code across the SDK, web console, and desktop app, plus wiring the `--activity-routing` flag through the CLI daemon to enable per-session routing.

## Implementation Details

### SDK React (`sdk/react/`)

- **SessionComposer**: Removed runner imports, `runnerId`/`onRunnerIdChange` props, `showRunner` state, runner resolution block, runner-switch safety effect, runner configure menu item, `WorkspaceRunnerSelector` in toolbar, and the entire `RunnerConfigPanel` component (~200 lines)
- **WorkspaceEditor**: Removed `RunnerFileBrowser` import and drill-in view, runner props (`runnerId`, `runnerName`, `runnerHostname`), simplified `canBrowse` from `enableLocal && !!runnerId` to `enableLocal`
- **useRecentWorkspaces**: Renamed `runnerId` parameter to `scopeId` throughout (preserves localStorage key prefix for data compatibility)
- **ContextChip**: Removed `"runner"` from ChipItem type union and labels map
- **icons.tsx**: Deleted `RunnerIcon` export
- **structural-share.ts**: Removed `runnerId` equality check from status comparison
- **useDeleteResource**: Removed `"runner"` from `DeletableResourceKind` union and switch cases
- **Tests**: Removed runner mock and runner validation gate tests from `useNewSessionFlow.test.tsx`

### Web Console (`client-apps/web/`)

- Deleted runner pages: `src/app/runners/`, `src/app/runners/[id]/`, `src/app/settings/runners/`
- Deleted runner domain: `src/domain/runner/RunnerDetailPage.tsx`, `src/domain/runner/RunnersSection.tsx`
- Removed runner sidebar link and `Server` icon import from `Sidebar.tsx`
- Removed stale `runnerId` props from `SessionLauncher.tsx`

### Desktop App (`client-apps/desktop/`)

- Removed stale `runnerId` props from `SessionLauncher.tsx`

### CLI (`client-apps/cli/`)

- Added `ActivityRouting` field to `daemon.StartOptions`
- Added `--activity-routing` flag to `stigmer up` and `stigmer up server` commands
- Wired through to `STIGMER_ACTIVITY_ROUTING` env var in daemon process environment

## Benefits

- All three TypeScript packages compile cleanly (`tsc --noEmit` passes)
- 475/475 SDK React tests pass, 3/3 desktop tests pass
- 0 lint errors across all packages
- Desktop sidecar can now start with `stigmer up --activity-routing session` for per-session routing
- File browsing uses native Tauri dialog — faster, no runner dependency

## Impact

- **SDK consumers**: `SessionComposer` no longer accepts `runnerId`/`onRunnerIdChange` props — these are breaking changes to the public API, but the underlying Runner API was already deleted, making these props non-functional
- **Web console users**: Runner management pages removed from navigation — runners are now automatic, not user-managed
- **CLI users**: New `--activity-routing` flag available on `stigmer up`

## Related Work

- T02: Runner API proto deletion (this session cleans up what T02 missed)
- T04: Per-session task queue routing in Go server
- T05: Java control plane Runner domain refactor
- T06c: Per-session worker spawning (next — requires architecture decision)

---

**Status**: ✅ Production Ready (T06a/b/d complete, T06c pending architecture decision)
**Timeline**: Single session (~40 minutes)
