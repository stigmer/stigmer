# Fix BiDi Proxy Authentication Failure

**Date**: June 1, 2026

## Summary

Fixed a critical authentication failure in the Cursor BiDi proxy that prevented the HTTP/2 interceptor from injecting `x-stigmer-auth` on SDK requests outside of AsyncLocalStorage execution context. The bug caused `REFUSED_STREAM` errors in local dev and would have manifested identically in production. Also tightened the integration test auth config to reject non-Stigmer tokens, ensuring this class of bug is caught at test time.

## Problem Statement

After completing the BiDi proxy implementation (Phase 2, sessions 1–12), the proxy worked in integration tests but failed in local dev with:

```
BiDi stream: authentication failed
InvalidBearerTokenException: Signed JWT rejected: Another algorithm expected, or no matching key(s) found
```

### Pain Points

- Agent executions via `make desktop-dev` failed with auth errors on the BiDi proxy
- The Cursor SDK retried token exchange 6 times in 8 seconds (retry storm)
- 241 Connect RPC envelopes were processed but no `turn_ended` billing event was extracted
- Integration tests passed — masking the bug due to an accept-all fallback in test auth config
- The same bug would have hit production (released desktop apps and cloud runners use identical code)

## Solution

The root cause was in the HTTP/2 interceptor (`http2-interceptor.ts`), which gated `x-stigmer-auth` injection on `ctx?.executionId && config`. This meant only requests inside an AsyncLocalStorage execution context received the auth header. SDK-internal requests (bootstrap, analytics, reconnects) opened outside execution context reached the BiDi proxy without `x-stigmer-auth`, causing the handler to fall back to the `authorization` header — which contained a Cursor access token that no provider in the authentication chain could validate.

## Implementation Details

### Runner HTTP/2 interceptor (stigmer OSS)

Decoupled auth header injection from execution context. `x-stigmer-auth` is now injected on **all** HTTP/2 requests to the proxy endpoint (whenever `config` is set). The `x-stigmer-execution-id` header remains conditional on execution context — it's only meaningful for billing-tracked agent streams.

```typescript
// Before (buggy): auth gated on executionId
if (ctx?.executionId && config) { ... }

// After (fixed): auth always injected on proxy connections
if (config) {
    augmented[STIGMER_AUTH_HEADER] = `Bearer ${config.stigmerToken}`;
    if (ctx?.executionId) {
        augmented[EXECUTION_ID_HEADER] = ctx.executionId;
    }
}
```

### Integration test auth (stigmer-cloud)

Tightened `IntegrationTestSecurityConfig.authenticationManager()` to reject non-Stigmer tokens when `StigmerJwtVerifier` is configured. Previously, the test auth manager blindly accepted all tokens (`authentication.setAuthenticated(true)`), which masked the interceptor bug. Now:

1. Stigmer JWTs (`iss="stigmer"`) — verified and accepted
2. Non-Stigmer JWTs — rejected with `OAuth2AuthenticationException`
3. Non-JWT tokens — rejected

Falls back to accept-all only when `StigmerJwtVerifier` is not configured (no signing key), with a warning to set `STIGMER_JWT_SIGNING_KEY`.

### BiDi handler diagnostic logging (stigmer-cloud)

Auth failure log messages now include the request path, token source (`x-stigmer-auth` vs `authorization` fallback), and a safe 12-character token prefix for identification without credential exposure.

## Benefits

- Eliminates `REFUSED_STREAM` errors on non-agent SDK RPCs routed through the BiDi proxy
- Prevents the SDK retry storm (6 token exchanges in 8 seconds) caused by stream-level auth failures
- Integration tests now catch interceptor auth regressions before they reach local dev or production
- Diagnostic logging makes future BiDi auth issues immediately diagnosable from the error log alone

## Impact

- **Runner** (all deployment modes): HTTP/2 interceptor behavior change — auth always injected
- **Integration tests**: Stricter auth validation — may surface latent issues in test setups without `STIGMER_JWT_SIGNING_KEY`
- **BiDi handler**: Enhanced error logging only — no behavioral change
- **Production risk**: Low — the fix adds auth headers that were always intended to be present; no removal of existing behavior

## Related Work

- Phase 2 BiDi proxy: `_projects/2026-05/20260531.01.cursor-bidi-proxy-phase2/`
- Session 12 TLS fix: `6cb7b4209` (desktop-dev REFUSED_STREAM due to HTTP/1.1 fallback)
- Phase 1 billing stopgap: `_changelog/2026-05/2026-05-31-154028-fix-cursor-billing-pipeline-phase1.md`

---

**Status**: ✅ Production Ready (pending manual local dev verification)
**Timeline**: 1 session (~45 minutes investigation + implementation)
