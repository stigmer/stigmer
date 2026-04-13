# Go OSS Backend: OAuth Parity Fixes (T02/T03 Dual Implementation)

**Date**: April 13, 2026

## Summary

Fixed 5 core-classification parity gaps in the Go OSS backend (stigmer-server) that were identified during the T05 BYOA implementation. These gaps span T02 (disconnect + grant health) and T03 (refresh hardening, vendor gate, error UX) — features that were implemented in the Java cloud backend but had no Go counterpart. All T04/T05 BYOA features were explicitly classified as cloud-only and intentionally left unimplemented in Go.

## Problem Statement

The Java backend (stigmer-cloud) received OAuth improvements across T02 and T03, but the Go backend (stigmer-server) was not updated. This created behavioral divergence on core features: OSS users couldn't disconnect OAuth connections, saw misleading "Connected" status, had agents silently running with expired tokens, and received cryptic error messages.

### Pain Points

- **No disconnect flow**: Users stuck with stale OAuth grants forever (T02 GAP 2)
- **Misleading "Connected" status**: Grant health not evaluated — expired tokens showed as "Connected" (T02 GAP 3)
- **Silent expired token injection**: Execution-path refresh failures were swallowed, letting agents run with expired tokens (T03 GAP 4)
- **Missing vendor approval gate**: `initiateOAuthConnect` didn't check `VendorApprovalStatus`, allowing bypass of the UI gate via direct API calls (T03 GAP 8)
- **Cryptic connect errors**: All Temporal workflow failures mapped to `codes.DeadlineExceeded` with raw metadata (T03 GAP 9)

## Solution

Five focused changes following the backend engineer role's edition classification framework. Each gap was classified as **core** (both editions) or **cloud-only** (Java only). BYOA features (T04/T05) were classified as cloud-only — organization-level OAuth overrides have no meaningful equivalent in a single-user OSS environment.

## Implementation Details

### Fix 1: `disconnectOAuth` handler (T02 GAP 2)

New handler in `disconnect_oauth.go` with idempotent desired-state semantics matching the Java implementation. Prerequisites: added `Delete` to `environment.Client` and `DeleteManagedEnvironment` to `ManagedEnvironmentService`. Delete order: managed environment (secrets) first, then grant (metadata). No error for missing grants.

### Fix 2: `OAuthConnectionHealth` evaluation (T02 GAP 3)

Enhanced `get_oauth_grant_status.go` with `evaluateHealth()` computing the health enum (HEALTHY / TOKEN_EXPIRED_REFRESHABLE / TOKEN_EXPIRED / NO_GRANT). Uses the same 60-second buffer as `RefreshTokenIfExpired` so the UX signal matches execution behavior.

### Fix 3: Hard failure for execution-path refresh (T03 GAP 4)

Changed `injectMcpOAuthFromManagedEnvironment` in `create_execution_context_step.go` from soft failure (warn + continue) to hard failure (propagate error as `FAILED_PRECONDITION`). The existing `RefreshTokenIfExpired` error messages already include server name and remediation hints.

### Fix 4: Vendor approval backend enforcement (T03 GAP 8)

Added `VendorApprovalStatus` check in `initiateVendorOAuth` after OAuthApp resolution. PENDING/REJECTED apps return `FAILED_PRECONDITION` with the same error message text as the Java handler — clients switching editions see identical errors.

### Fix 5: Layered connect workflow error handling (T03 GAP 9)

Replaced the `codes.DeadlineExceeded` catch-all in `executeConnectWorkflow` with layered Temporal error inspection: `ApplicationError` -> INTERNAL with root cause, `TimeoutError` -> DEADLINE_EXCEEDED with server name, `serviceerror.NotFound` -> UNAVAILABLE, default -> INTERNAL with context. Follows patterns already established in `invoke_workflow_impl.go`.

### Edition Classification: Cloud-Only (Not Implemented)

The following T04/T05 features are intentionally unimplemented in Go:
- BYOA infrastructure (OAuthAppOverrideRepo, resolution service, SQLite migration)
- BYOA handlers (setOrgOAuthApp, getOrgOAuthApp, deleteOrgOAuthApp) — `codes.Unimplemented` is correct
- Resolution chain in initiateOAuthConnect / token refresh — direct slug lookup is correct for OSS
- ClientId mismatch detection — only triggered by BYOA override changes

## Benefits

- OSS users can now disconnect stale OAuth connections
- "Connected" status accurately reflects token health
- Agents no longer silently run with expired tokens in OSS
- Vendor approval gate is enforced at the API level in both editions
- Connect failures show human-readable messages with remediation hints
- Error messages are identical between Go and Java for all user-facing errors

## Impact

- **Backend (stigmer-server)**: 1 new file, 6 modified files (142 insertions, 19 deletions)
- **Tests**: All existing tests pass (5 packages, 0 failures)
- **Backward compatibility**: No proto changes; all changes are additive behavior

## Related Work

- [T02: Disconnect + grant health (Java)](2026-04-13-133813-implement-oauth-disconnect-and-grant-health.md)
- [T03: Refresh + vendor gate + error UX (Java)](2026-04-13-131630-harden-oauth-refresh-vendor-gate-error-ux.md)
- [T05: BYOA handlers (Java, stigmer-cloud)](../../stigmer-cloud/_changelog/2026-04/2026-04-13-162138-byoa-handlers-resolution-chain-integration.md)

---

**Status**: Production Ready
