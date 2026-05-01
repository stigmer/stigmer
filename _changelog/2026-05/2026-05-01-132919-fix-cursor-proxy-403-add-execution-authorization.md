# Fix Cursor Proxy 403 and Add Execution-Level Authorization to Side-Channel Proxies

**Date**: May 1, 2026

## Summary

Fixed a critical bug in the CursorProxyController that caused all POST requests (including the Cursor SDK's `/auth/exchange_user_api_key` key exchange) to crash with a `java.lang.IllegalArgumentException: restricted header name: "content-length"`. Also rotated an expired Cursor API key to the correct key type. Additionally, added execution-level OpenFGA authorization to both the LLM and Cursor proxies to prevent authenticated users from making arbitrary API calls outside valid execution contexts.

## Problem Statement

Agent executions via the Cursor harness were failing with a generic `[a] Error` message in the runner and `Internal system error occurred` in the UI. Investigation revealed two distinct issues:

### Pain Points

- **API key type mismatch**: The Cursor API key was generated from the "Admin API Keys" section of the dashboard, but the Cloud Agents SDK requires a key from the "Integrations/MCP" tab. The Admin key returned 401 on all endpoints
- **Proxy POST crash**: After rotating to a valid key, GET requests (`/v1/models`) succeeded but POST requests (`/auth/exchange_user_api_key`) still failed. The CursorProxyController forwards all non-blocklisted request headers to the upstream Java HttpClient, but `content-length` is a restricted header that Java's HttpClient computes automatically from the body publisher -- setting it manually throws `IllegalArgumentException`
- **No execution-level authorization**: Both the LLM and Cursor proxies only validated authentication (is this a valid Stigmer user?) but performed no authorization (is this user allowed to make this call?). Any authenticated user who discovered the proxy endpoint could make unlimited LLM/Cursor API calls on the platform's keys

## Solution

Three-part fix across both repositories:

1. **Content-length fix** (stigmer-cloud): Added `content-length` and `expect` to `NON_FORWARDABLE_REQUEST_HEADERS` in `CursorProxyController` -- these are Java HttpClient restricted headers that must not be forwarded manually
2. **API key rotation** (stigmer-cloud): Updated `cursor.yaml` with a key generated from the Cursor Dashboard Integrations/MCP tab and applied it via Planton
3. **Execution authorization** (stigmer + stigmer-cloud): Added `X-Stigmer-Execution-Id` header propagation from runners and FGA `can_edit` checks on the server-side proxies

## Implementation Details

### stigmer (OSS runner-side)

**Cursor runner** (`fetch-interceptor.ts`, `execute-cursor.ts`):
- Extended `ProxyConfig` interface with optional `executionId` field
- Modified `replaceAuth()` to inject `X-Stigmer-Execution-Id` header when present
- Added `setInterceptorExecutionId()` function called at Temporal activity start
- Wired `executionId` from `executeCursor()` activity into the interceptor config

**Agent runner** (`config.py`, `setup.py`, `generate_session_subject.py`):
- Added `execution_id` parameter to `LLMConfig.build_llm_kwargs()`
- When set, includes `X-Stigmer-Execution-Id` in `default_headers` on the LLM client
- Threaded `execution_id` through `_perform_setup_core()` and `_generate_title()`

### stigmer-cloud (server-side)

**CursorProxyController.java**:
- Added `content-length` and `expect` to `NON_FORWARDABLE_REQUEST_HEADERS`
- Added `x-stigmer-execution-id` to blocklist (strip before forwarding upstream)
- Injected `ProxyAuthorizationService` for FGA checks
- Added `authorizeExecution()` method with soft/hard enforcement

**LlmProxyController.java**:
- Injected `ProxyAuthorizationService` for FGA checks
- Added `authorizeExecution()` with same soft/hard enforcement pattern

**application.yaml**:
- Added `stigmer.proxy.require-execution-id` config (defaults to `false` for migration)

### Diagnosis methodology

The 403 was traced through K8s pod logs which showed:
```
Cursor proxy: host=api.cursor.com path=/v1/models           -> status=200
Cursor proxy: host=api2.cursor.sh path=/auth/exchange_user_api_key
ERROR: restricted header name: "content-length"
```

GET requests succeeded (no `content-length` header). POST requests crashed before reaching Cursor's backend. Spring returned the exception as an error response that the SDK reported as "API key exchange failed with status 403".

## Benefits

- **Cursor harness unblocked**: POST-based Cursor SDK flows (key exchange, agent operations) now work correctly through the proxy
- **Security hardened**: Proxy calls are now scoped to valid executions via FGA, preventing abuse of platform API keys
- **Migration-safe**: Soft enforcement (warn-and-allow) by default lets existing runners update before hard enforcement is enabled

## Impact

- All Cursor harness agent executions that were previously failing will now succeed
- Both LLM and Cursor proxy endpoints now perform execution-scoped authorization
- Runner images will need to be updated to include the `X-Stigmer-Execution-Id` header before switching to hard enforcement

## Related Work

- [Fix protobuf bytes deserialization](2026-05-01-121753-fix-protobuf-bytes-deserialization.md) -- previous Cursor harness fix in same session
- [Fix cursor activity temporal routing](2026-05-01-114424-fix-cursor-activity-temporal-routing.md) -- deterministic queue routing fix

---

**Status**: Production Ready (soft enforcement mode)
**Timeline**: ~3 hours (diagnosis + implementation)
