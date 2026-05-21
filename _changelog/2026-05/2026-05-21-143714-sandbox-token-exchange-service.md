# Sandbox Token Exchange Service

**Date**: May 21, 2026

## Summary

Replaced the pattern of forwarding the caller's raw JWT to cloud sandboxes with a purpose-built, session-scoped Stigmer-signed token (4h TTL). Sandboxes now receive a delegation credential that is independent of the user's auth provider, has a predictable lifetime, and carries only the claims needed for sandbox operation. Stale-token-aware sandbox recreation handles token expiry without requiring a renewal mechanism.

## Problem Statement

Cloud sandboxes received `STIGMER_TOKEN` set to the caller's raw JWT from the gRPC context. This had three issues:

### Pain Points

- **Unpredictable token lifetime**: PlatformClient tokens expire in 15 minutes, Auth0 tokens in ~24 hours. The sandbox couldn't predict when its credential would die — when it did, proxy calls (LLM, checkpoints, artifacts) failed silently mid-conversation.
- **Over-broad credential**: The user's full login token gave the sandbox the same access the user has in their browser. A compromised sandbox would leak the user's full session identity.
- **Multi-provider inconsistency**: Each auth provider (Auth0, federated SSO, API keys, PlatformClient) produced a different token shape and lifetime. The sandbox provisioner had to treat them all as opaque blobs with unknown expiry.

## Solution

Mint a **Stigmer-signed JWT** scoped to the specific session at sandbox provisioning time, replacing the forwarded user token. The server resolves the caller's `identityAccountId` from the gRPC interceptor context (normalized across all auth providers) and issues a new token with:

- `iss=stigmer`, `sub=identityAccountId` (same as PlatformClient tokens — no new auth provider needed)
- `session_id` claim for audit and future revocation
- `token_type=sandbox` to distinguish from PlatformClient user tokens
- 4-hour TTL (configurable via `stigmer.jwt.signing.sandbox-token-ttl-seconds`)

For token expiry, track `tokenExpiresAt` on the `SessionSandbox` MongoDB record. On every execution, `ensureExistingSandbox` checks token freshness before deciding whether to restart or recreate the sandbox. If the token is expired or within a 10-minute grace window, the sandbox is recreated from scratch with a fresh token (Daytona preserves original env vars on restart, so recreation is the only way to inject a new token).

## Implementation Details

### New: `SandboxTokenService` (~100 lines)
Domain service in `domain/agentic/sandbox/` that mints session-scoped JWTs using the shared `StigmerJwtKeySource` RSA key pair. Separate from `StigmerJwtIssuer` because sandbox tokens have different claims, TTL, and lifecycle than PlatformClient user tokens.

### Modified: `SessionSandbox` record
Added `tokenExpiresAt` field (nullable `Instant`) with `isTokenStale(graceSeconds)` method. Nullable for backward compatibility with legacy records created before token exchange — those are treated as non-stale.

### Modified: `DaytonaSandboxProvisioner`
Added stale-token check as the first gate in `ensureExistingSandbox`, before the Daytona state switch. If stale, short-circuits to `recreateSandbox` without querying Daytona (the sandbox will be replaced regardless). `TOKEN_STALE_GRACE_SECONDS = 600` (10 minutes).

### Modified: `EnsureSessionSandboxStep` (both handlers)
Replaced `UserTokenHolder.get()` with `InterceptorContextHolder.getContext().getCaller().getIdentityAccountId()` + `SandboxTokenService.mintForSession()`. The interceptor context is stored in gRPC Context (survives SecurityContextHolder mutations from in-process calls).

### Auth chain verification
Sandbox tokens flow through the existing `PlatformClientTokenAuthenticationProvider` (matches `iss=stigmer`). The `platform_client_id` claim is absent (null), which flows safely through `RequestCallerIdentityMapper.map()` — FGA authorization uses only `identityAccountId`. No new auth provider needed.

## Benefits

- **Predictable 4h lifetime** regardless of user's auth provider (was 15min–24h depending on provider)
- **Session-scoped** — token carries `session_id` for audit trails and future per-session revocation
- **Auto-recovery** — stale tokens trigger sandbox recreation, not silent failures
- **Reduced blast radius** — sandbox token is narrower than user's full browsing JWT
- **Zero runner changes** — TypeScript runner treats `STIGMER_TOKEN` as opaque Bearer credential
- **Zero proxy changes** — FGA authorization continues through `identityAccountId` in token's `sub` claim

## Impact

- **Cloud-only** — OSS Go server has no auth, no sandboxes, no changes
- **stigmer-cloud**: 11 files changed (2 new, 9 modified), 492 insertions, 42 deletions
- **Tests**: 7 new `SandboxTokenServiceTest` tests + 4 new stale-token tests in `DaytonaSandboxProvisionerTest`. All 61 Bazel tests pass.

## Related Work

- Cloud sandbox provisioning (2026-05-21-134002)
- Runner architecture simplification project (`20260520.01`)
- Desktop embedded runner execution target routing (2026-05-20-215359)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes implementation + testing)
