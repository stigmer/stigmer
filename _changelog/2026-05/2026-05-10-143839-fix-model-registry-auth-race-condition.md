# Fix Model Registry Auth Race Condition in Desktop Release Builds

**Date**: May 10, 2026

## Summary

Fixed the model selector showing "No models found" in desktop release builds (`make release-desktop-local`) while dev mode (`make launch-desktop`) worked correctly. The root cause was a one-shot model registry fetch that fired before PKCE authentication completed, received a 401, and never retried.

## Problem Statement

After building the Stigmer Desktop app with `make release-desktop-local` and launching it, the model selector dropdown displayed "No models found" with no indication of what went wrong.

### Pain Points

- Models loaded fine in dev mode but never in release builds, creating a confusing inconsistency
- The fetch error was silently swallowed -- loading, auth failure, and empty results all showed the same "No models found" message
- The only workaround was a full app restart after authentication, and even that was unreliable with expired tokens

## Solution

Three-layer defense against the auth race condition:

1. **Token polling with timeout** -- when the initial `getAuthCredential()` returns `null`, poll every 500ms for up to 10 seconds, giving the PKCE auth flow time to complete before firing the API request
2. **Retry with exponential backoff** -- on fetch failure, retry up to 3 times at 1s/2s/4s intervals, handling transient 401s from expired tokens and network blips
3. **Distinct UI states in ModelSelector** -- loading spinner, error with retry button, and "no models" are now distinguishable

## Implementation Details

### `useModelRegistryFetch` rewrite (`provider.tsx`)

The previous implementation used a bare `useEffect(…, [])` that ran exactly once on mount. The new version:

- Polls `getAuthCredential()` in a loop when the token is initially `null`, with a configurable timeout (`TOKEN_POLL_MAX_MS = 10_000`)
- Uses `AbortController` for clean cancellation on unmount or manual refetch
- Tracks retry attempts via a ref and schedules retries at `[1_000, 2_000, 4_000]` ms delays
- Exposes a `refetch()` callback via context for manual retry from the UI
- Bumps a `version` counter to re-trigger the effect on manual refetch

### `ModelRegistryState` interface update (`ModelRegistryContext.ts`)

Added a `refetch: () => void` field to the context state interface, enabling consumer components to trigger a fresh fetch without remounting the provider.

### `useModelRegistry` hook update (`useModelRegistry.ts`)

Propagated `refetch` from context through the hook's return type so `ModelSelector` and other consumers can access it.

### `ModelSelector` UI states (`ModelSelector.tsx`)

Replaced the single "No models found" catch-all with three distinct states:

- **Loading**: animated spinner with "Loading models..." text
- **Error**: "Failed to load models" message with a Retry button that calls `refetch()`
- **Empty search/filter**: the original "No models found" (only when fetch succeeded but no models match)

### Test fixture updates

Added the `refetch` field to all `ModelRegistryState` test fixtures across three test files to match the updated interface.

## Benefits

- Desktop release builds now reliably load models even on first launch (fresh localStorage, no cached tokens)
- Users see clear feedback when model loading fails, with an actionable retry button
- Transient network errors and token refresh races self-heal without app restart
- No structural changes to `StigmerProvider` or `App.tsx` -- existing consumers are unaffected

## Impact

- **Desktop app**: Primary fix target -- resolves the empty model selector in release builds
- **Web console**: Also benefits from the retry logic and error UI, though the race condition was less likely there due to cookie-based auth
- **SDK consumers**: `useModelRegistry` now exposes `refetch` and `ModelRegistryState` includes the field, which is a minor additive API change

## Related Work

- Desktop PKCE auth implementation (`_changelog/2026-04/2026-04-25-*-desktop-cloud-auth-pkce-deep-link.md`)
- Desktop Tauri scaffolding (`_changelog/2026-04/2026-04-23-*-stigmer-desktop-tauri-scaffolding.md`)

---

**Status**: ✅ Production Ready
