# DD-03: Proxy SDK with Interceptor Hooks (Not Config-Only Docker Image)

**Date**: 2026-02-19
**Status**: Approved

## Decision

Stigmer ships a Go library (`stigmer-proxy-sdk`) that integrators use to build their proxy. The SDK provides token exchange, gRPC forwarding, and user/org extraction. Integrators add custom interceptors (authorization, logging, etc.). Also ship a pre-built Docker image for simple internal-only deployments.

## Context

Originally proposed a config-only Docker image (deploy + set env vars). A critical security review revealed that auto-granting org membership based solely on a valid JWT is unsafe if the proxy is user-facing — users could change the org_id in gRPC messages to access orgs they don't belong to. Each platform has its own authorization model, so the proxy must support custom authz logic.

## Consequences

- Integrators write ~20 lines of Go to build their proxy
- Custom authorization interceptors prevent org spoofing
- Industry-validated pattern (Temporal SDK, gRPC-Go middleware, Connect-Go, Express.js)
- Pre-built Docker image available for internal-only deployments (behind existing authz layer)
- Language lock-in to Go (acceptable for Planton; multi-language SDKs can come later)

## Example

```go
proxy := stigmerproxy.New(
    stigmerproxy.WithStigmerEndpoint("api.stigmer.ai:443"),
)
proxy.AddUnaryInterceptor(myAuthzInterceptor())
proxy.Start(":9090")
```
