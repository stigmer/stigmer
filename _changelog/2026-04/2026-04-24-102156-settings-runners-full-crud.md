# Settings > Runners Full CRUD

**Date**: April 24, 2026

## Summary

Upgraded the read-only Settings > Runners page into a full management surface with per-row Stop and Delete actions (inline confirmation, no modals) and a page-level "Launch Local Runner" button. All action logic lives in the SDK (`@stigmer/react`) for platform builder reuse; the Console remains a thin orchestrating shell.

## Problem Statement

The Settings > Runners page displayed runner fleet information but provided no way to manage runners from the browser. Users had to use the CLI to stop or remove runners, and there was no browser-based way to trigger a local runner launch via the `stigmer://` URL scheme.

### Pain Points

- No way to stop a misbehaving runner from the web console
- No way to delete stale or terminated runners without CLI access
- No way to trigger a local runner launch from the browser (the `stigmer://` flow was wired end-to-end but had no web UI trigger)
- The Settings > Runners page was the only Settings section without CRUD actions

## Solution

Evolved `RunnerListPanel` (SDK component) with self-contained Stop and Delete mutations following the `ApiKeyListPanel` inline-delete pattern. Added "Launch Local Runner" button to `RunnersSection` (Console) following the `OAuthAppsSection` CTA pattern. Six design decisions (DD-T08-01 through DD-T08-06) govern the interaction model.

## Implementation Details

### SDK: `RunnerListPanel` (`sdk/react/src/runner/RunnerListPanel.tsx`)

- **Action menu**: `⋮` dropdown button on each non-system-managed runner row. READY/BUSY runners show Stop + Delete; STOPPED/FAILED/PENDING show Delete only.
- **Inline confirmation**: Row transforms to destructive border/bg with contextual message, error display, and confirm/cancel buttons. Only one confirmation active across the entire list (`{ runnerId, action } | null` state).
- **Self-contained mutations**: Each `RunnerRow` internally calls `useStopRunner()` and `useDeleteRunner()`. After success: clear confirmation, auto-refetch list, fire optional `onStopped`/`onDeleted` notification callback.
- **System-managed exclusion**: Runners with `stigmer.ai/system-managed: "true"` label show no action affordances — only the existing "System" badge.
- **New optional props**: `onStopped?: (runner: Runner) => void`, `onDeleted?: (runner: Runner) => void`. Fully backward compatible.

### Console: `RunnersSection` (`client-apps/web/src/domain/settings/RunnersSection.tsx`)

- "Launch Local Runner" text button in section header, wired to `useLaunchLocalRunner` hook.
- Loading state during token creation, error feedback on failure.
- `onRefetchRef` connected to `RunnerListPanel` for post-launch list refresh.

### Design Decisions

- **DD-T08-01**: Per-row inline actions, not a detail panel — runners have no editable fields.
- **DD-T08-02**: Inline confirmation, no modals — avoids portal/z-index issues for SDK embedders.
- **DD-T08-03**: System-managed runners excluded from actions — auto-provisioned runners should not be manually managed.
- **DD-T08-04**: Launch button in Console section header, not list panel — "create" analog follows OAuthApp/ApiKey pattern.
- **DD-T08-05**: Self-contained mutations inside RunnerListPanel — follows ApiKeyListPanel pattern, headless hooks available for custom UI.
- **DD-T08-06**: Phase-based action visibility — Stop only for active phases, Delete for all non-system runners.

## Benefits

- Runners are now fully manageable from the web console without CLI access
- The `stigmer://` browser-to-desktop launch flow has a visible trigger in the UI
- Platform builders get a self-contained runner management component via `@stigmer/react`
- Zero breaking changes to existing consumers

## Impact

- **Direct users**: Can now stop, delete, and launch runners from Settings > Runners
- **Platform builders**: Can embed `<RunnerListPanel>` with built-in lifecycle management
- **Architecture**: Completes the Settings CRUD pattern across all infrastructure resources

## Related Work

- Phase 3 project: `20260423.02.phase3-persistent-runners-browser-launch` (T08 of 9)
- T07: SDK runner action hooks (`useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner`)
- T06: Runner stop via command stream (server-side `stop` RPC)
- T02: Server-side launch token endpoints (`createLaunchToken`, `exchangeLaunchToken`)
- Desktop T05: `stigmer://` deep link handling in Tauri desktop app

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
