# Identity Account Gate — Console Auto-Provisioning for First-Time Signups

**Date**: May 3, 2026

## Summary

Added an `IdentityAccountGate` to the Stigmer console's provider chain that ensures every authenticated user has an identity account before the app renders. New users who sign up via Auth0 are now automatically provisioned via `provisionMyAccount` on their first console visit, replacing the old asynchronous webhook pipeline that was removed earlier in this project.

## Problem Statement

After removing the Auth0 webhook-based identity provisioning pipeline, new direct Auth0 signups would arrive at the console with a valid JWT but no identity account in the database. The old pipeline asynchronously created the account and personal org via a webhook — that path no longer exists.

### Pain Points

- New users who sign up directly via Auth0 would hit a broken state — `findMyOrganizations()` returns nothing, the org gate times out after 10 seconds of polling, and the user sees the manual org creation form instead of their auto-provisioned personal workspace.
- No explicit identity resolution step existed in the console's provider chain — the app jumped straight from auth to org loading.

## Solution

Introduced a two-layer gate following the established SDK hook + console component pattern:

1. **`useIdentityAccountGate`** — headless hook in `@stigmer/react` that drives a 4-state machine (`checking` → `provisioning` → `ready` | `error`). Calls `whoAmI()` to resolve the caller's identity; on `NOT_FOUND`, calls `provisionMyAccount()` to create the account and personal org.

2. **`IdentityAccountGate`** — console-specific UI component that renders gate screens (spinner, welcome/provisioning, error with retry) based on the hook state.

The gate is wired between `StigmerTransportBridge` and `OrgProvider` in the console's provider chain, ensuring the identity account and personal org exist before `findMyOrganizations()` is called.

## Implementation Details

### New files

- `sdk/react/src/identity-account/useIdentityAccountGate.ts` — headless hook with stale-request protection (`attemptRef`), proper `isNotFound()` error classification from `@stigmer/sdk`, and bypass for disabled-auth deployments.
- `sdk/react/src/identity-account/index.ts` — module barrel.
- `client-apps/web/src/domain/_shared/identity/IdentityAccountGate.tsx` — console gate component matching the visual language of `OrgGate` (shared `GateHeader`, spinner, welcome screen, error screen with retry).

### Modified files

- `sdk/react/src/index.ts` — exports `useIdentityAccountGate`, `IdentityAccountGateState`, `UseIdentityAccountGateReturn`.
- `client-apps/web/src/providers/Providers.tsx` — inserted `IdentityAccountGate` at position 6 in the provider chain, between `StigmerTransportBridge` and `OrgProvider`.

### Design decisions

- **SDK-level hook, console-level UI**: Follows the `useOrgGate` / `OrgGate` pattern. The hook belongs in `@stigmer/react` so Planton and other consumers can adopt it (replacing Planton's fragile `message.includes("not found")` guard).
- **Bypass for disabled-auth mode**: When `isEnabled: false`, the hook immediately reports `ready` without making any RPC calls, avoiding failures in auth-disabled development deployments.
- **No changes to `useOrgGate`**: The old provisioning polling in `useOrgGate` is now effectively dead code for the direct signup path but is left intact — it's harmless and may still serve SSO edge cases.

## Benefits

- **Zero-friction first-time onboarding**: New Auth0 signups are silently provisioned on first console visit. No manual steps, no waiting for async webhooks.
- **Idempotent and safe**: The `provisionMyAccount` backend handler is idempotent — retries and race conditions are handled gracefully.
- **Reusable**: The `useIdentityAccountGate` hook is available to any `@stigmer/react` consumer, not just the console.
- **Proper error handling**: Uses `isNotFound()` from the SDK for gRPC status code classification, unlike the string-matching approach used in Planton's `useIdentityAccountGuard`.

## Impact

- **Console users**: First-time Auth0 signups now see a brief "Setting up your account..." screen instead of a broken state or timeout.
- **Returning users**: One additional `whoAmI` RPC per page load (fast, authenticated gRPC-Web unary call) before the app renders.
- **SDK consumers**: New public API surface in `@stigmer/react` (`useIdentityAccountGate` hook + types).

## Related Work

- Auth0 webhook pipeline cleanup (same project session — removed 19+ files of webhook infrastructure)
- `provisionMyAccount` RPC implementation (same project session — backend handler + proto + codegen)
- Planton's `useIdentityAccountGuard` — can be migrated to use this SDK hook in the future

---

**Status**: ✅ Production Ready
**Timeline**: Part of the 20260503.04.auth0-webhook-pipeline-cleanup project
