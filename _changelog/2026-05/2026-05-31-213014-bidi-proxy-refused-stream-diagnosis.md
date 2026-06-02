# BiDi Proxy REFUSED_STREAM: Root Cause Diagnosis and Fix

**Date**: May 31, 2026

## Summary

Diagnosed and fixed the Netty HTTP/2 REFUSED_STREAM that blocked end-to-end validation of the BiDi proxy billing pipeline. Two independent root causes were identified through evidence-driven investigation: a test security configuration gap that produced empty user identities for the Netty auth path, and a port readiness race condition in the integration test harness.

## Problem Statement

The integration test `TestAgentExecution_CursorUsage_FullPipeline` failed consistently with HTTP/2 `REFUSED_STREAM` (error code 0x7). Session 8 notes reported "zero CursorBidiStreamHandler log lines" and attributed it to a Netty frame-level issue. This blocked validation of the Option A (`x-stigmer-auth`) implementation.

### Pain Points

- Integration test blocked for 2 sessions — no end-to-end validation possible
- Two distinct failure modes observed (REFUSED_STREAM vs empty billing) with no clear connection
- Initial hypothesis (Netty codec-level refusal) was wrong — misdirected investigation

## Solution

Evidence-driven diagnosis using existing test output logs, not speculative code changes.

### Root Cause 1: Auth Identity Mapping Gap (PRIMARY)

The `IntegrationTestSecurityConfig` had three authentication paths — servlet filter (REST/Tomcat), gRPC interceptor, and shared `AuthenticationManager`. The REST and gRPC paths both resolved Stigmer JWTs into `PlatformClientAuthenticationToken` with a proper `identityAccountId`. But the BiDi handler's Netty path only used the `AuthenticationManager`, which accepted tokens without converting them. `RequestCallerIdentityMapper` couldn't map the raw `BearerTokenAuthenticationToken`, producing `user=""` and FGA authorization denial — which the handler surfaced as `RST_STREAM(REFUSED_STREAM)`.

**Fix**: Updated the test `AuthenticationManager` bean to accept `StigmerJwtVerifier`, verify incoming Stigmer JWTs, and return `PlatformClientAuthenticationToken` — mirroring the gRPC interceptor's behavior.

### Root Cause 2: Port Readiness Race (SECONDARY)

The test harness (`service.go`) waited for the gRPC port (120s timeout) but not the BiDi proxy port. The BiDi proxy starts at Spring `SmartLifecycle` phase `DEFAULT_PHASE - 1` (near the end of the lifecycle). In the failing rerun, the Go PathRoutingProxy sent requests 17 seconds before the BiDi proxy bound its port.

**Fix**: Added `waitForPortOrExit` for the BiDi port (60s timeout) after the gRPC port check.

## Implementation Details

### stigmer-cloud: IntegrationTestSecurityConfig.java

The `AuthenticationManager` bean now resolves Stigmer-signed JWTs via `StigmerJwtVerifier`:

```java
@Bean
AuthenticationManager authenticationManager(StigmerJwtVerifier jwtVerifier) {
    return authentication -> {
        if (authentication instanceof BearerTokenAuthenticationToken bearer
                && jwtVerifier.isConfigured()) {
            try {
                var verified = jwtVerifier.verify(bearer.getToken());
                return new PlatformClientAuthenticationToken(
                        verified.getSubject(), "bidi-proxy-auth", bearer.getToken());
            } catch (Exception e) { /* not a Stigmer JWT — fall through */ }
        }
        authentication.setAuthenticated(true);
        return authentication;
    };
}
```

### stigmer: test/integration/harness/service.go

Added BiDi port readiness wait after gRPC port check:

```go
bidiAddr := fmt.Sprintf("127.0.0.1:%s", bidiPortStr)
if err := waitForPortOrExit(ctx, bidiAddr, 60*time.Second, exitCh); err != nil {
    _ = cmd.Process.Kill()
    logFile.Close()
    return nil, fmt.Errorf("java service BiDi proxy port not ready: %%w", err)
}
```

## Key Insight: Investigation Methodology

The initial hypothesis ("Netty frame-level refusal") was wrong. The breakthrough came from reading existing service logs in `.test-output/`, which revealed `Proxy authorization denied: user= permission=can_edit` — the handler WAS being invoked, but the auth identity was empty. This redirected the investigation from the Netty codec layer to the Spring Security identity mapping chain.

The two failure modes that appeared unrelated were actually two sides of the same coin:
- **Mode A (REFUSED_STREAM)**: Port readiness race — handler never invoked
- **Mode B (empty billing)**: Auth denied — handler invoked but stream refused at the application level

## Remaining Work

After fixing both root causes, a new issue surfaced: the Cursor SDK agent run returns `status: error` with no detail. The BiDi proxy is correctly forwarding traffic to upstream `api2.cursor.sh`, but the upstream responds with an error. This was previously masked — when auth denied the BiDi stream, the SDK likely retried via a direct connection path.

This is a separate issue requiring investigation in the next session.

## Impact

- Unblocks end-to-end validation of the Option A billing pipeline
- Eliminates intermittent port readiness race in all cursor harness tests
- Establishes the auth identity mapping pattern for any future Netty-based handlers that use Spring Security

## Related Work

- Session 8: Option A (`x-stigmer-auth`) implementation
- Session 7: HTTP/2 interceptor for Connect RPC streams
- Session 5: BiDi proxy routing fix (CURSOR_BACKEND_URL)

---

**Status**: In Progress (fixes applied, upstream SDK error requires next-session investigation)
**Timeline**: Session 9 (diagnosis + fix: ~1 hour)
