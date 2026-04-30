# Design Decision: Cursor SDK Proxy Support

**Date**: 2026-04-30 (revised)
**Task**: T05 -- CLI Daemon Multi-Worker Management
**Status**: DECIDED -- Proxy IS feasible via `global.fetch` interception

## Context

Stigmer has a well-established pattern for handling LLM provider credentials in cloud deployments:

- Runners are **credential-free**. They do not hold Anthropic/OpenAI API keys.
- LangChain's `base_url` is pointed at `STIGMER_PROXY_ENDPOINT/v1/proxy/llm/{provider}`, authenticating with `STIGMER_TOKEN`.
- The Java `LlmProxyController` in stigmer-cloud holds the real provider keys and injects them on outbound requests.

**Non-negotiable requirement**: Managed runners must only need `STIGMER_TOKEN` to operate. They hold zero provider credentials.

## Research

### SDK Has No `baseURL` Parameter

The `@cursor/sdk` `AgentOptions` interface has no `baseURL`, `apiEndpoint`, or proxy parameter. The endpoint is hardcoded internally.

### But: The SDK Uses `fetch()` Internally

The SDK requires Node.js 20+, which provides `fetch()` via undici. The SDK communicates with `api2.cursor.sh` using HTTP/2 bidirectional streaming (gRPC-Connect) with automatic SSE fallback.

### And: Cursor Explicitly Supports Enterprise Proxies

From Cursor's Network Configuration docs: enterprise proxies (including Zscaler) are supported. When HTTP/2 bidi fails through a proxy, the SDK falls back to SSE transparently. This means routing SDK traffic through a reverse proxy works -- worst case, the SDK uses SSE mode.

### Additional Finding: Full REST API Exists

Cursor's Cloud Agents API at `https://api.cursor.com/v1/...` provides full agent lifecycle management (create, run, stream via SSE, cancel, artifacts) over standard HTTP. This is trivially proxyable but limited to cloud agents.

## Decision: `global.fetch` Interception + Reverse Proxy

The proxy pattern IS achievable by intercepting `global.fetch` at the JavaScript level before the SDK loads. This is the JavaScript-level equivalent of LangChain's `base_url`.

### How It Works

1. **Fetch interceptor** (`cursor-runner/src/proxy/fetch-interceptor.ts`):
   - Installed at startup BEFORE `@cursor/sdk` is imported
   - Intercepts outbound `fetch()` calls to `*.cursor.sh` / `*.cursor.com`
   - Rewrites URL: `https://api2.cursor.sh/path` → `{STIGMER_PROXY_ENDPOINT}/v1/proxy/cursor/api2.cursor.sh/path`
   - Replaces auth: `Bearer {CURSOR_API_KEY}` → `Bearer {STIGMER_TOKEN}`
   - Non-Cursor requests pass through unmodified

2. **CursorProxyController** (stigmer-service, separate task):
   - Reverse proxy at `/v1/proxy/cursor/**`
   - Authenticates caller with STIGMER_TOKEN
   - Strips Stigmer auth, injects `CURSOR_API_KEY` from platform config
   - Forwards to original Cursor endpoint
   - Supports HTTP/2 passthrough and SSE streaming

3. **config.ts**:
   - When `STIGMER_PROXY_ENDPOINT` is set: no `CURSOR_API_KEY` needed (proxy mode)
   - When not set: `CURSOR_API_KEY` required (direct mode, local/OSS)

### Env Var Contract for cursor-runner

| Mode | CURSOR_API_KEY | STIGMER_TOKEN | STIGMER_PROXY_ENDPOINT | Behavior |
|------|---------------|---------------|----------------------|----------|
| Local (direct) | Required | Optional | Not set | SDK uses key directly |
| Cloud (proxy) | Not needed | Required | Required | Fetch interceptor routes through proxy |

### Why This Works

- `global.fetch` interception is reliable -- Node.js 20+ uses undici's fetch, which respects the global
- The interceptor runs BEFORE the SDK captures its fetch reference (module loading order)
- Cursor documents that their services work through enterprise proxies
- HTTP/2 bidi failure triggers automatic SSE fallback (transparent to our code)
- The proxy implementation is architecturally identical to `LlmProxyController`

### Risk Mitigation

- **HTTP/2 bidi through proxy**: If the proxy doesn't support HTTP/2, the SDK's SSE fallback activates automatically. This is how Zscaler proxies work with Cursor today.
- **SDK internal changes**: If the SDK stops using `fetch()`, the interceptor would need updating. Low risk -- `fetch()` is the standard Node.js HTTP API.

## Comparison with LLM Proxy Pattern

| Aspect | LLM (Anthropic/OpenAI) | Cursor SDK |
|--------|----------------------|------------|
| SDK `baseURL` support | Yes (LangChain) | No (SDK has no param) |
| Proxy mechanism | LangChain `base_url` | `global.fetch` interception |
| Cloud key delivery | Proxy injects on outbound | Proxy injects on outbound |
| Runner holds provider key | No | No |
| Security model | STIGMER_TOKEN only | STIGMER_TOKEN only |
| Local mode | User provides key directly | User provides key directly |
| Proxy implementation | LlmProxyController | CursorProxyController (same pattern) |
