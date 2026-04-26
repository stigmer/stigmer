# Fix Runner Start Error Handling and Hide System-Managed Runners

**Date**: April 26, 2026

## Summary

Fixed two user-facing issues on the Runners page: the "Start Runner" dialog in the Desktop app silently swallowed errors during the token-exchange phase (making the button appear broken), and system-managed ephemeral runners were displayed by default in both the Desktop and Web Console runner lists when they should be hidden from normal users.

## Problem Statement

### Pain Points

- Clicking "Start" in the Desktop app's Start Runner dialog produced no visible feedback when the underlying API calls failed (e.g., `createLaunchToken` returning `UNIMPLEMENTED` in OSS mode, or auth/network errors). The `try/catch` block only captured errors from the Tauri sidecar step, not from the token creation and exchange steps that precede it.
- The `isStarting` loading state only covered the sidecar invocation, leaving no loading indicator during the token exchange phase.
- System-managed (ephemeral cloud) runners labeled `stigmer.ai/system-managed: "true"` appeared alongside user-created runners in both the Desktop and Web Console runner lists, creating confusion for users who did not create them.
- The `RunnerListPanel` SDK component defaulted `includeSystemManaged` to `true`, contradicting the `useRunnerList` hook's default of `false` and violating the principle that the zero-config path should serve the common case.

## Solution

Two targeted fixes, both frontend-only with no proto or backend changes required.

**Error handling**: Added `launchError` and `isLaunching` state to the Desktop `RunnersPage` to cover the full start flow (token creation, token exchange, sidecar start). Errors are classified by type (`UNIMPLEMENTED`, auth, network, sidecar) and surfaced inline within the dialog via a new `error` prop on `StartRunnerDialog`. The loading state now spans the entire async sequence.

**System-managed filtering**: Changed the `RunnerListPanel` component's `includeSystemManaged` default from `true` to `false`, aligning it with the `useRunnerList` hook default. Removed the explicit `includeSystemManaged: true` from the Desktop `RunnersPage`. Admin views that need full fleet visibility can opt in with `includeSystemManaged={true}`.

## Implementation Details

### Desktop RunnersPage (`client-apps/desktop/src/pages/runners/RunnersPage.tsx`)

- Added `launchError` (string | null) and `isLaunching` (boolean) state
- Rewrote `handleStart` to set loading state at entry, classify and surface errors for the full flow, and reset in `finally`
- Added `describeStartFlowError()` utility that classifies errors into user-friendly messages for: UNIMPLEMENTED (OSS mode guidance), auth failures, expired tokens, network issues, duplicate runners, sidecar failures
- Passed combined `isLaunching || isStarting` as loading prop and `launchError ?? startError` as error prop to the dialog
- Removed the page-level error banner (errors now appear in-dialog for better co-location)
- Removed `{ includeSystemManaged: true }` from `useRunnerList` call

### StartRunnerDialog (`client-apps/desktop/src/pages/runners/StartRunnerDialog.tsx`)

- Added optional `error` prop (string | null)
- Renders error inline between form fields and action buttons using `role="alert"` and `bg-destructive-subtle` token (theme-compliant)

### RunnerListPanel (`sdk/react/src/runner/RunnerListPanel.tsx`)

- Changed `includeSystemManaged` prop default from `true` to `false`
- Updated JSDoc on the prop and component to reflect the new default and document the opt-in path

## Benefits

- Users now see clear, actionable error messages when runner start fails, instead of a silently broken button
- OSS users specifically see guidance to use `stigmer auth login` and `stigmer up` instead of the launch-token flow
- The loading indicator spans the full async sequence, preventing confusion about whether the button was clicked
- System-managed runners no longer clutter the runner list for normal users in both Desktop and Web Console
- The SDK component default is now consistent with the hook default, reducing surprise for platform builders

## Impact

- **Desktop app users**: Start Runner dialog now provides error feedback and loading state for the full flow
- **Web Console users**: Runner list no longer shows ephemeral system runners by default
- **SDK consumers**: `RunnerListPanel` default change from `true` to `false` is a behavioral change. Platform builders who relied on the previous default to show system-managed runners will need to pass `includeSystemManaged={true}` explicitly. This aligns with the documented intent that system-managed runners are for admin views.

## Related Work

- `2026-04-26-163214-desktop-runner-launch-token-exchange.md` — introduced the token exchange flow in `handleStart`
- `2026-04-22-212455-settings-runners-admin-page.md` — original implementation of `RunnerListPanel`

---

**Status**: Production Ready
