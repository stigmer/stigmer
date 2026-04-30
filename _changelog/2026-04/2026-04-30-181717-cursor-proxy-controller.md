# CursorProxyController: Server-Side Cursor SDK Proxy

**Date**: April 30, 2026

## Summary

Implemented the server-side HTTP reverse proxy for Cursor SDK traffic in stigmer-cloud, completing the credential-free runner architecture for the Cursor harness. The proxy follows the same pattern as `LlmProxyController` -- it receives fetch-intercepted requests from cursor-runner, validates the upstream host against an allowlist, injects the platform Cursor API key, and streams the response back.

## Problem Statement

The Cursor harness (T03-T05) established a `global.fetch` interceptor that rewrites Cursor SDK HTTP calls to route through Stigmer's proxy endpoint. The runner-side plumbing was complete, but the server-side component that receives those proxied requests, authenticates the caller, injects the real Cursor API key, and forwards to the upstream Cursor API did not exist.

### Pain Points

- Cursor SDK has no `baseURL` parameter, so the proxy is the only mechanism for credential-free runners
- Without the server-side proxy, cursor-runner in cloud mode cannot reach the Cursor API
- The proxy must enforce a host allowlist to prevent open relay abuse -- the URL encodes the upstream hostname in the path, so an attacker could target arbitrary hosts without validation

## Solution

Created `CursorProxyController` following the established `LlmProxyController` pattern: a Spring Boot `@RestController` mapped to `/v1/proxy/cursor/{upstreamHost}/**` that validates the upstream host, reconstructs the original URL, injects `Authorization: Bearer {CURSOR_API_KEY}`, and streams the upstream response via `StreamingResponseBody`.

## Implementation Details

### CursorProxyController (`proxy/cursor/CursorProxyController.java`)

- **Path mapping**: `@RequestMapping("/v1/proxy/cursor")` with `@PostMapping("/{upstreamHost}/**")` catch-all
- **Host allowlist**: `Set.of("api2.cursor.sh", "api.cursor.com", "api.cursor.sh")` -- rejects non-Cursor hosts with 403
- **Upstream URL reconstruction**: Extracts full path after the host segment using `HttpServletRequest.getRequestURI()` and preserves query strings
- **Auth injection**: Replaces inbound `Authorization` (which carries `STIGMER_TOKEN`) with `Authorization: Bearer {CURSOR_API_KEY}` from `CursorProxyConfig`
- **Header forwarding**: Forwards all request headers except hop-by-hop (`Connection`, `Transfer-Encoding`, `Keep-Alive`, `TE`, `Trailer`, `Upgrade`, `Proxy-Authorization`, `Proxy-Authenticate`) and auth-related headers. More permissive than `LlmProxyController` to support Cursor's gRPC-Connect/SSE protocol headers.
- **Streaming**: `HttpClient` with `HTTP_1_1` version (forces SSE fallback per Cursor enterprise guidance), `BodyHandlers.ofInputStream()`, 5-minute timeout
- **Error handling**: 502 for missing API key or upstream failures, 403 for disallowed hosts
- **Logging**: Request/response logging with user identity, upstream host, latency, and status code

### CursorProxyConfig (`config/proxy/CursorProxyConfig.java`)

- `@ConfigurationProperties(prefix = "stigmer.proxy.cursor")` with single `apiKey` field
- Bound to `STIGMER_PROXY_CURSOR_API_KEY` environment variable via `application.yaml`

### Configuration Changes

- `application.yaml`: Added `cursor:` block under `stigmer.proxy:` with `api-key: ${STIGMER_PROXY_CURSOR_API_KEY:}`
- `_kustomize/base/service.yaml`: Added `STIGMER_PROXY_CURSOR_API_KEY` referencing `$secrets-group/cursor/prod.api-key`
- `_ops/planton/service-hub/secrets-group/cursor.yaml`: New `SecretsGroup` manifest (applied to Planton)

### Key Architectural Decisions

- **HTTP/1.1 over HTTP/2**: Cursor documents SSE fallback as standard for enterprise proxies. Starting with HTTP/1.1 avoids HTTP/2 bidi streaming complexity. Can upgrade later if SSE latency is measurable.
- **Kustomize base, not prod overlay**: Existing LLM proxy keys are in `_kustomize/base/service.yaml`, not the prod overlay. Followed the established pattern.
- **No HTTPRoute changes**: The existing `/v1/proxy` prefix route to port 8081 already covers `/v1/proxy/cursor/**`.

## Benefits

- Cursor harness runners are now fully credential-free in cloud mode (only `STIGMER_TOKEN` required)
- Architecturally identical to the LLM proxy pattern -- one pattern, two implementations
- Host allowlist prevents SSRF / open relay abuse
- Streaming support ensures long-running Cursor agent executions work without timeout or buffering issues

## Impact

- **Platform operators**: The Cursor proxy completes the server-side infrastructure for the Cursor harness feature
- **Cloud runners**: cursor-runner pods need only `STIGMER_TOKEN` and `STIGMER_PROXY_ENDPOINT`
- **Security**: Centralized API key management -- the Cursor service account key never leaves stigmer-service

## Related Work

- [T05: CLI Daemon Multi-Worker + Cursor Proxy](2026-04-30-160850-cli-daemon-multi-worker-cursor-proxy.md) -- runner-side fetch interceptor
- [T03: Cursor Runner TypeScript Service](2026-04-30-144627-cursor-runner-typescript-service.md) -- the TypeScript worker that makes the SDK calls
- [T04: Workflow Harness Dispatch](2026-04-30-152442-workflow-harness-dispatch.md) -- Go/Java workflow routing by harness
- Design decision: [cursor-sdk-proxy-support.md](_projects/2026-04/20260430.01.cursor-harness/design-decisions/cursor-sdk-proxy-support.md)

---

**Status**: Production Ready (pending real API key and integration test)
**Timeline**: Single session
