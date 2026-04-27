# Desktop Runner Start: Full Investigation and Fix

**Date**: April 27, 2026

## Summary

End-to-end investigation and fix of the desktop app's "Start Runner" flow, which was completely broken. Starting from a cryptic "Unable to issue credentials" error, the investigation uncovered six interacting issues across four layers (backend Java, CLI Go, desktop Rust, desktop TypeScript) and an SDK gap. All issues were resolved and the runner now starts successfully from the desktop app.

## Problem Statement

Clicking "Start Runner" in the desktop app produced the error "StigmerError: Unable to issue credentials — contact your administrator." Investigation revealed this was the tip of an iceberg — multiple bugs at different layers compounded to create a broken experience.

## Root Causes Found and Fixed

### 1. Backend: LaunchTokenService misused PlatformClient JWT issuer

`LaunchTokenService.create()` called `StigmerJwtIssuer.mintUserToken()` to re-mint the caller's credential as a Stigmer-signed JWT. This failed when `STIGMER_JWT_SIGNING_KEY` was not configured, and was architecturally wrong — the PlatformClient JWT issuer should not be used for direct Stigmer users.

**Fix** (stigmer-cloud): Changed `LaunchTokenService` to store the caller's existing Bearer credential (Auth0 JWT, PlatformClient JWT, or API key) directly in Redis instead of re-minting. Removed `StigmerJwtIssuer` dependency entirely.

### 2. Desktop app: Unnecessary launch token round-trip

The desktop app's `RunnersPage` called `createLaunchToken` then immediately `exchangeLaunchToken` in the same process — a server round-trip to convert an Auth0 JWT into a Stigmer JWT, when the Auth0 JWT was already available locally.

**Fix** (stigmer): Created `useRunnerCredential` SDK hook in `@stigmer/react` that resolves the current auth credential from the `Stigmer` client. Desktop app consumes this hook instead of the launch token flow.

### 3. CLI: Missing `--org` flag

The `stigmer up runner` command had no `--org` flag. The desktop sidecar passed `--org suresh` but Cobra rejected the unknown flag. The CLI fell back to `~/.stigmer/config.yaml` which had a different org where the user lacked membership.

**Fix** (stigmer): Added `--org` flag to both `stigmer up` and `stigmer up runner`, threaded `OrgOverride` through `StartOptions` to `ResolveBackendInfo`.

### 4. Desktop sidecar: Fire-and-forget process spawning

The Tauri `start_runner` command spawned the CLI child process and returned `Ok` immediately, before the CLI finished registration. Errors were invisible because the frontend received "success" and closed the dialog.

**Fix** (stigmer): Added 8-second grace period after spawn. If the CLI exits with non-zero during that window, stderr is collected and returned as `Err`.

### 5. Desktop UI: No async error listeners

Even with the grace period, if the CLI failed after the window, the `runner:stopped` and `runner:error` events were emitted but nothing listened for them.

**Fix** (stigmer): Added `useEffect` in `RunnersPage` that listens for `runner:stopped` (non-zero exit code) and `runner:error` events and surfaces them via the dialog's error state.

### 6. Desktop UI: Generic error messages hiding real causes

`describeStartFlowError` replaced real CLI stderr output with generic messages like "Authentication failed. Please log in again." — hiding the actual problem.

**Fix** (stigmer): Show the raw CLI error directly in the dialog.

### 7. Tauri sidecar name collision (bonus)

Tauri v2 forbids a sidecar with the same name as the Cargo package. Both were "stigmer".

**Fix** (stigmer): Renamed sidecar to "stigmer-cli" across `tauri.conf.json`, `sidecar.rs`, the symlink, and `setup-sidecar-dev.sh`.

## Files Changed

### stigmer repo
- `sdk/react/src/runner/useRunnerCredential.ts` (new) — SDK behavior hook
- `sdk/react/src/runner/index.ts` — barrel export
- `sdk/react/src/index.ts` — top-level barrel export
- `client-apps/desktop/src/pages/runners/RunnersPage.tsx` — consume SDK hook, async error listeners, raw error display
- `client-apps/cli/cmd/stigmer/root/up.go` — `--org` flag
- `client-apps/cli/internal/cli/runner/start.go` — `OrgOverride` in `StartOptions`
- `client-apps/cli/internal/cli/runner/backend_info.go` — `OrgOverride` in `ResolveOptions`
- `client-apps/desktop/src-tauri/src/sidecar.rs` — grace period, sidecar rename
- `client-apps/desktop/src-tauri/tauri.conf.json` — sidecar rename
- `client-apps/desktop/scripts/setup-sidecar-dev.sh` — sidecar rename

### stigmer-cloud repo
- `LaunchTokenService.java` — pass-through instead of re-mint
- `LaunchTokenServiceTest.java` — updated tests

## Follow-Up: Runner List Auto-Refresh

After a runner is started, the Runners page does not automatically refresh to show status transitions (Pending -> Online). The user must navigate away and back to see the updated status.

**Recommended fix**: Add periodic polling (e.g., every 10 seconds) to `useRunnerList` while there are runners in non-terminal states (Pending, Online), or trigger a refetch when `runner:started` / `runner:stopped` Tauri events are received. This should be implemented as a `refetchInterval` option on the SDK's `useRunnerList` hook so platform builders benefit too.

---

**Status**: ✅ Production Ready (runner start flow complete; auto-refresh is a follow-up)
