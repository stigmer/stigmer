# Task: CursorProxyController (stigmer-cloud)

**Created**: 2026-04-30
**Status**: READY FOR IMPLEMENTATION
**Depends on**: T05 (cursor-runner multi-worker + fetch interceptor -- COMPLETED)
**Repo**: stigmer-cloud
**Estimated scope**: Small-medium (one Java controller, one config class, one route manifest)

## Why This Exists

Stigmer's runner architecture has a non-negotiable property: **managed runners only need `STIGMER_TOKEN` to operate.** They hold zero provider credentials. This is how the Python agent-runner works today for LLM calls:

```
Runner → STIGMER_PROXY_ENDPOINT/v1/proxy/llm/anthropic → Stigmer injects ANTHROPIC_API_KEY → api.anthropic.com
```

The Cursor harness needs the same property. The Cursor SDK (`@cursor/sdk`) has no `baseURL` parameter, so we can't redirect it at the SDK level. Instead, we intercept `global.fetch` in Node.js before the SDK loads, rewriting Cursor-bound requests to route through a Stigmer proxy. **The runner-side work is done** (T05). This task implements the **server-side proxy** that receives those rewritten requests.

## What's Already Built (T05)

### Fetch Interceptor (cursor-runner side -- DONE)

File: `backend/services/cursor-runner/src/proxy/fetch-interceptor.ts`

When `STIGMER_PROXY_ENDPOINT` is set, the interceptor rewrites requests:

```
Original:   POST https://api2.cursor.sh/aiserver.v1.AgentService/CreateAgent
            Authorization: Bearer {whatever-SDK-passes}

Rewritten:  POST https://api.stigmer.ai/v1/proxy/cursor/api2.cursor.sh/aiserver.v1.AgentService/CreateAgent
            Authorization: Bearer {STIGMER_TOKEN}
```

The URL encodes the **original Cursor hostname** in the path so the proxy knows where to forward. The auth header is replaced with `STIGMER_TOKEN`.

### Config (cursor-runner side -- DONE)

File: `backend/services/cursor-runner/src/config.ts`

Two modes:
- **Direct** (local): `CURSOR_API_KEY` required, no proxy, fetch interceptor is a no-op
- **Proxy** (cloud): `STIGMER_PROXY_ENDPOINT` + `STIGMER_TOKEN` required, no `CURSOR_API_KEY` needed

### main.ts Load Order (DONE)

The fetch interceptor installs BEFORE the SDK is imported (dynamic `import()` of worker.ts). This ensures the SDK captures the intercepted `fetch`, not the original.

## What Needs to Be Built (This Task)

### 1. CursorProxyController

**Location**: `backend/services/stigmer-service/src/main/java/ai/stigmer/proxy/cursor/CursorProxyController.java`

**Pattern**: Architecturally identical to the existing `LlmProxyController`. Same package structure, same auth model, same streaming approach.

**Path mapping**:
```
Incoming:   POST /v1/proxy/cursor/{upstreamHost}/**
            Authorization: Bearer {STIGMER_TOKEN}

Outgoing:   POST https://{upstreamHost}/**
            Authorization: Bearer {CURSOR_API_KEY}
```

**Reference implementation** to follow:

```
backend/services/stigmer-service/src/main/java/ai/stigmer/proxy/llm/LlmProxyController.java
```

Key elements from the LLM proxy to replicate:
- `@RestController` + `@RequestMapping("/v1/proxy/cursor")`
- Spring Security auth (same `Authentication` object, same filter chain on port 8081)
- `HttpClient` with streaming via `HttpResponse.BodyHandlers.ofInputStream()` + `StreamingResponseBody`
- Provider auth injection in `buildUpstreamRequest`
- Forwardable header filtering
- Cost attribution logging (`user={} latency_ms={}`)
- 5-minute request timeout (Cursor operations are long-running)

**Differences from LLM proxy**:

| Aspect | LlmProxyController | CursorProxyController |
|--------|-------------------|----------------------|
| Path variable | `/{provider}` (openai, anthropic) | `/{upstreamHost}` (api2.cursor.sh, api.cursor.com) |
| Upstream resolution | `config.resolveBaseUrl(provider)` | Directly from path: `https://{upstreamHost}` |
| Auth injection | Provider-specific (Bearer for OpenAI, x-api-key for Anthropic) | Always `Authorization: Bearer {CURSOR_API_KEY}` |
| Config class | `LlmProxyConfig` with per-provider blocks | `CursorProxyConfig` with single API key |
| Allowed hosts | N/A (providers are named) | **Allowlist**: only `api2.cursor.sh`, `api.cursor.com`, `api.cursor.sh` |

**Security: Upstream host allowlist is critical.** The path encodes the upstream hostname, so without validation an attacker could use the proxy to reach arbitrary hosts. The controller MUST reject requests where `{upstreamHost}` is not in the Cursor domain allowlist.

```java
private static final Set<String> ALLOWED_HOSTS = Set.of(
    "api2.cursor.sh",
    "api.cursor.com",
    "api.cursor.sh"
);
```

### 2. CursorProxyConfig

**Location**: `backend/services/stigmer-service/src/main/java/ai/stigmer/config/proxy/CursorProxyConfig.java`

**Pattern**: Same as `LlmProxyConfig` but simpler -- single API key, no per-provider blocks.

```java
@Data
@Configuration
@ConfigurationProperties(prefix = "stigmer.proxy.cursor")
public class CursorProxyConfig {
    private String apiKey;  // CURSOR_API_KEY for the platform service account
}
```

**Environment variable**: `STIGMER_PROXY_CURSOR_API_KEY` (follows the existing `STIGMER_PROXY_OPENAI_API_KEY` naming pattern).

### 3. HTTPRoute Update

**Location**: `_ops/planton/infra-hub/kubernetes/stigmer-proxy-path-route.yaml`

The existing route already matches `/v1/proxy` prefix and routes to port 8081. The Cursor proxy lives under `/v1/proxy/cursor/**`, which falls under the existing rule. **No changes needed** unless you want a separate route for monitoring.

### 4. Kubernetes Config

**Location**: `backend/services/stigmer-service/_kustomize/overlays/prod/service.yaml`

Add the Cursor API key secret reference:

```yaml
STIGMER_PROXY_CURSOR_API_KEY:
  value: $secrets-group/stigmer-proxy/cursor-api-key
```

This follows the same pattern as `STIGMER_PROXY_OPENAI_API_KEY` and `STIGMER_PROXY_ANTHROPIC_API_KEY`.

## Streaming Considerations

The Cursor SDK uses two protocols:

1. **HTTP/2 bidirectional streaming** (gRPC-Connect) -- primary
2. **HTTP/1.1 Server-Sent Events (SSE)** -- automatic fallback

Cursor explicitly documents that when HTTP/2 bidi fails through a proxy (e.g., Zscaler), the SDK falls back to SSE transparently.

**For the proxy implementation**:
- Java's `HttpClient` supports HTTP/2 (`HttpClient.Version.HTTP_2`)
- The `StreamingResponseBody` pattern in `LlmProxyController` already handles streaming correctly
- If HTTP/2 bidi passthrough is problematic, the proxy can limit itself to HTTP/1.1. The SDK will automatically use SSE mode.
- **Recommendation**: Start with `HttpClient.Version.HTTP_1_1` (forces SSE fallback). Upgrade to HTTP/2 only if SSE latency is measurable. SSE is what Zscaler enterprise deployments use with Cursor today.

## Request Flow Diagram

```
cursor-runner (cloud pod)
  │
  │  STIGMER_PROXY_ENDPOINT = https://api.stigmer.ai
  │  STIGMER_TOKEN = eyJ...
  │  No CURSOR_API_KEY
  │
  ├─ Cursor SDK calls fetch("https://api2.cursor.sh/aiserver.v1.AgentService/Send")
  │
  ├─ fetch-interceptor.ts rewrites:
  │   URL:  https://api.stigmer.ai/v1/proxy/cursor/api2.cursor.sh/aiserver.v1.AgentService/Send
  │   Auth: Bearer eyJ... (STIGMER_TOKEN)
  │
  ├─ Gateway routes /v1/proxy/* → stigmer-service:8081
  │
  ├─ Spring Security authenticates STIGMER_TOKEN
  │
  ├─ CursorProxyController:
  │   1. Extracts upstreamHost = "api2.cursor.sh" from path
  │   2. Validates against allowlist
  │   3. Resolves CURSOR_API_KEY from CursorProxyConfig
  │   4. Builds upstream request:
  │      URL:  https://api2.cursor.sh/aiserver.v1.AgentService/Send
  │      Auth: Bearer sk-... (real CURSOR_API_KEY)
  │   5. Forwards request, streams response back
  │
  └─ SDK receives response as if it talked to Cursor directly
```

## Env Var Summary

### On stigmer-service (proxy side)

| Variable | Value | Description |
|----------|-------|-------------|
| `STIGMER_PROXY_CURSOR_API_KEY` | `sk-...` (Cursor service account key) | Platform-level Cursor API key. Injected into outbound requests. |

### On cursor-runner (runner side, already configured)

| Variable | Value | Description |
|----------|-------|-------------|
| `STIGMER_PROXY_ENDPOINT` | `https://api.stigmer.ai` | Proxy base URL. Activates fetch interceptor. |
| `STIGMER_TOKEN` | `eyJ...` | Auth token for proxy requests. |
| `MODE` | `cloud` | Enables cloud-mode Temporal and backend config. |
| `CURSOR_API_KEY` | Not set | Not needed in proxy mode. |

## Testing Checklist

- [ ] Controller starts and accepts requests on port 8081 at `/v1/proxy/cursor/**`
- [ ] Spring Security authenticates `STIGMER_TOKEN` on proxy requests
- [ ] Upstream host allowlist rejects non-Cursor hosts (e.g., `/v1/proxy/cursor/evil.com/path` → 403)
- [ ] `STIGMER_PROXY_CURSOR_API_KEY` is injected as `Authorization: Bearer` on outbound requests
- [ ] Streaming responses (SSE) are relayed without buffering
- [ ] Request/response headers forwarded correctly (Content-Type, etc.)
- [ ] Latency and user attribution logged for cost tracking
- [ ] 502 returned when `STIGMER_PROXY_CURSOR_API_KEY` is not configured
- [ ] 502 returned when upstream Cursor service is unreachable
- [ ] Long-running requests (5+ minutes for agent executions) don't timeout prematurely

## Files to Create/Modify

**New files:**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/proxy/cursor/CursorProxyController.java`
- `backend/services/stigmer-service/src/main/java/ai/stigmer/config/proxy/CursorProxyConfig.java`

**Modified files:**
- `backend/services/stigmer-service/_kustomize/overlays/prod/service.yaml` -- add `STIGMER_PROXY_CURSOR_API_KEY`
- Possibly `_ops/planton/infra-hub/kubernetes/` -- if separate HTTPRoute desired

## Decisions Already Made (Do Not Revisit)

These were decided during T05 and should not be reconsidered:

1. **`global.fetch` interception is the mechanism** -- the Cursor SDK has no `baseURL` param. The fetch interceptor is implemented and committed.

2. **URL rewriting embeds the original hostname in the path** -- format is `/v1/proxy/cursor/{upstreamHost}/{path}`. This allows the proxy to forward to the correct Cursor service.

3. **Auth replacement, not injection** -- the interceptor replaces the entire auth header (from SDK's key to STIGMER_TOKEN). The proxy replaces it again (from STIGMER_TOKEN to real CURSOR_API_KEY). The SDK's dummy key value (`"proxy-managed"`) never reaches Cursor.

4. **SSE fallback is acceptable** -- Cursor documents this as the standard behavior through enterprise proxies. No need to optimize for HTTP/2 bidi passthrough in the first version.

5. **Single platform-level Cursor API key** -- same model as LLM proxy. One service account key per Stigmer deployment. Per-org keys are a future enhancement (same as how LLM proxy works today).

6. **Host allowlist is a security requirement** -- the proxy must reject upstream hosts not in the Cursor domain set. This prevents the proxy from being used as an open relay.
