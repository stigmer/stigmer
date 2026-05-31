# BiDi Proxy: Option A — Dedicated `x-stigmer-auth` Header

**Date**: May 31, 2026

## Summary

Implemented Option A for the BiDi proxy dual-auth problem: a dedicated `x-stigmer-auth` HTTP/2 header that carries the Stigmer JWT for FGA/billing, separate from the `authorization` header used by the Cursor SDK's Connect RPC transport. All unit tests pass (TypeScript: 17/17, Java: 18 new tests). End-to-end integration test blocked by a pre-existing Netty-level `REFUSED_STREAM` issue unrelated to this change.

## Problem Statement

The BiDi proxy (Netty HTTP/2 handler) intercepts Connect RPC streams between the runner and Cursor's API. For billing, it needs to authenticate the runner's Stigmer identity (JWT → FGA `can_edit` check on `agent_execution`). However, the Cursor SDK's `connect-node` transport also uses the `authorization` header for its own token exchange flow.

### Pain Points

- Overwriting `authorization` with the Stigmer JWT broke the Cursor SDK's internal auth flow
- The `AuthenticationManager` could not validate Cursor access tokens for FGA (wrong principal type)
- A single `authorization` header cannot serve two purposes: Stigmer identity AND Cursor upstream auth

## Solution

Introduced a dedicated `x-stigmer-auth` header that carries the Stigmer JWT on a separate channel, leaving `authorization` untouched for the Cursor SDK:

- **Runner HTTP/2 interceptor**: injects `x-stigmer-auth: Bearer <stigmer-jwt>` + `x-stigmer-execution-id` per-stream from AsyncLocalStorage
- **Java BiDi handler**: reads `x-stigmer-auth` first for authentication/FGA, falls back to `authorization`/`x-api-key` for backward compatibility
- **Non-forwardable**: `x-stigmer-auth` is stripped before forwarding to Cursor upstream (alongside `authorization`, which is replaced with the configured API key)

## Implementation Details

### Runner (`stigmer` repo)

- `http2-interceptor.ts`: Renamed `AUTHORIZATION_HEADER` → `STIGMER_AUTH_HEADER` (`x-stigmer-auth`). The spread-then-set pattern (`{...headers, [STIGMER_AUTH_HEADER]: ...}`) adds the header without modifying any existing headers from the Cursor SDK.
- Removed `console.debug` diagnostic logging from `patchedConnect` (cleanup from session 7).

### Java Handler (`stigmer-cloud` repo)

- Added `STIGMER_AUTH_HEADER = "x-stigmer-auth"` constant
- Added `extractStigmerAuthToken(Http2Headers)` — package-private static for testability, handles `Bearer` prefix and raw token formats
- Updated `handleHeaders()`: `extractStigmerAuthToken` → fallback to `extractBearerToken` → null check → refuse
- Used effectively-final local variable pattern (`String stigmerToken = ...; String bearerToken = stigmerToken != null ? stigmerToken : extractBearerToken(...)`) to satisfy lambda capture constraint
- Added `x-stigmer-auth` to `NON_FORWARDABLE_REQUEST_HEADERS`

### Key Design Decision: Backward Compatibility

Requests without `x-stigmer-auth` fall through to the existing `authorization`/`x-api-key` extraction. This means:
- Older runners (without the interceptor) still work → UNSCOPED, unmetered
- The REST proxy path (fetch interceptor) is completely unaffected
- No Spring Security `AuthenticationManager` changes required

## Benefits

- Clean separation: Stigmer identity (x-stigmer-auth) vs Cursor upstream auth (authorization) serve distinct purposes on distinct headers
- No auth chain complexity: same `AuthenticationManager` bean validates Stigmer JWTs from either header path
- Fully backward compatible: zero disruption to existing flows
- Testable: both extraction methods are static/package-private with comprehensive unit tests

## Impact

- **Runner**: HTTP/2 interceptor now uses the correct dedicated header
- **Java BiDi handler**: authenticates Stigmer identity for FGA/billing without conflicting with Cursor SDK
- **No production users on cursor harness yet** — safe to iterate

## Related Work

- Session 7: HTTP/2 interceptor built and validated (ESM namespace fix)
- Session 6: Gzip decompression fix for Connect envelope decoding
- Session 5: Routing fix (CURSOR_BACKEND_URL + `/agent.v1` path prefix)

---

**Status**: In Progress (unit tests pass; integration test blocked by unrelated Netty REFUSED_STREAM)
**Timeline**: Session 8 of cursor-bidi-proxy-phase2
