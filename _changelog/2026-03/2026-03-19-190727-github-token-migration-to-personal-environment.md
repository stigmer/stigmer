# GitHub Token Migration to Server-Side Personal Environment

**Date**: March 19, 2026

## Summary

Migrated the GitHub OAuth access token from browser `localStorage` to encrypted server-side storage in the user's personal `Environment`. This eliminates XSS exposure of long-lived credentials while preserving zero-latency mount UX through a dual-source read strategy with automatic transparent migration.

## Problem Statement

The GitHub OAuth token was stored in `localStorage`, making it vulnerable to XSS attacks and device-specific — a user who authenticated on one browser couldn't use the same token on another. Since `localStorage` is accessible to any JavaScript running on the page, a single XSS vulnerability could exfiltrate the token.

### Pain Points

- Long-lived OAuth token exposed in browser-accessible storage
- Token not portable across devices or browsers
- No server-side awareness of the token's existence or validity
- Manual cleanup burden — disconnecting required only `localStorage.removeItem()`

## Solution

Store the GitHub token as a secret variable (`GITHUB_TOKEN`, `isSecret: true`) in the user's personal `Environment` — the same server-side encrypted infrastructure built in Phase 2 for agent env vars. The `useGitHubConnection` hook now composes `usePersonalEnvironment(org)` and implements a dual-source mount with automatic migration:

1. **Instant mount**: Read from `localStorage` for zero-latency provisional state
2. **Server reconciliation**: When the personal environment loads, reconcile across four cases (both sources, server only, local only, neither)
3. **Transparent migration**: If the token exists only in `localStorage`, migrate it to the personal environment and clean up local storage
4. **Disconnect cleanup**: Remove from both personal environment and `localStorage`

## Implementation Details

### Prerequisite: useRevealSecretValue Cleanup

Removed a stale `TODO(codegen)` type cast that bypassed TypeScript's type system. The `getSecretValue` method was already generated on `EnvironmentClient` — the cast dated from before SDK regeneration. Now uses `create(EnvironmentSecretValueInputSchema, { environmentId, key })` for fully typed invocation.

### Core Hook Rewrite: useGitHubConnection

- **New signature**: `useGitHubConnection(org: string | null)` — breaking change from no-arg. `null` disables server reconciliation (localStorage-only fallback for backward compatibility).
- **Composes `usePersonalEnvironment(org)`**: Uses `getOrCreate`, `addVariables`, `removeVariables` for all server-side token operations.
- **Reconciliation logic** (runs when personal env data loads):
  - **Case A** (server + local): Server is canonical — reveal, validate, clear `localStorage`
  - **Case B** (server only): Reveal and validate — `localStorage` already clean
  - **Case C** (local only): Migrate — `getOrCreate(initialData)` or `addVariables`, then clear `localStorage`
  - **Case D** (neither): Not connected
- **`disconnect()`**: Removes `GITHUB_TOKEN` from personal env via `removeVariables` (fire-and-forget), clears `localStorage` and `sessionStorage`
- **`handleCallback()`**: Unchanged — still stages to `localStorage`. Migration happens on next mount. This avoids a race condition where the personal environment hasn't loaded yet on the callback page.
- **Direct SDK call for `getSecretValue`**: Not `useRevealSecretValue` — the token must persist in memory for the page lifetime, not auto-clear after 30 seconds.

### Console Consumer Updates

Three call sites updated to pass `org`:
- `SessionLauncher.tsx` — org from `useActiveOrgSlug()`
- `SessionPage.tsx` — same
- `callback/page.tsx` — added `useActiveOrgSlug()` import, passes `org || null`

## Benefits

- **Security**: Token encrypted at rest on server, no longer readable by arbitrary client-side JavaScript
- **Portability**: Token accessible from any device/browser once authenticated
- **Zero UX regression**: Dual-source mount preserves instant-load behavior during migration period
- **Transparent migration**: Existing users are migrated automatically on next page load — no user action required
- **Clean disconnect**: Single `disconnect()` call cleans up both server and client storage
- **Type safety**: Removed unsafe type cast in `useRevealSecretValue`, all SDK calls are now fully typed

## Impact

- **Platform builders**: Breaking API change — `useGitHubConnection()` → `useGitHubConnection(org)`. The `null` parameter provides backward compatibility for gradual adoption.
- **End users**: Transparent — existing tokens are migrated automatically, new tokens are stored server-side from the start.
- **Security posture**: Eliminates the largest long-lived credential exposure in the client application.

## Related Work

- Phase 2: Personal environment orchestration hooks (`usePersonalEnvironment`, `usePersonalAgentInstance`)
- Phase 3: Backend env_spec whitelist filter — ensures `GITHUB_TOKEN` is excluded from agent executions unless explicitly declared
- Sub-project .05: SDK labels and env var ops — `updateVariables`/`removeVariables` RPCs used by migration flow

---

**Status**: ✅ Production Ready (pending e2e validation — T02.5)
**Timeline**: Phase 4 of project 20260319.02.agent-picker-personal-env
