# BiDi Proxy Kustomize + HTTPRoute Production Deployment

**Date**: May 31, 2026

## Summary

Exposed the Netty BiDi proxy (port 8082) in the Kubernetes service spec and deployed a supplementary HTTPRoute to route Connect RPC streaming traffic (`/aiserver.v1*`) through the Istio gateway to the dedicated Netty server. This completes the production routing infrastructure for proxy-authoritative Cursor billing.

## Problem Statement

The Netty BiDi proxy handler (Task 1) listens on port 8082 inside the container, but the Kubernetes Service only exposed ports 80 (gRPC) and 8081 (HTTP proxy). Without a service port and ingress route, external clients (released desktop apps, CLI-managed runners) cannot reach the proxy.

### Pain Points

- Port 8082 was invisible to the cluster network and Istio mesh
- No path-based routing existed for `/aiserver.v1*` Connect RPC paths
- Without `appProtocol: http2` on the service port, Istio would default to HTTP/1.1 — breaking bidirectional streaming

## Solution

Follow the established supplementary HTTPRoute pattern (same as port 8081 / `/v1/proxy`) to add port 8082 with path-based routing at the Gateway API layer.

## Implementation Details

### Port addition (`_kustomize/base/service.yaml`)

Added a third port entry to the `KubernetesDeployment` CRD:

```yaml
- name: cursor-bidi-proxy
  appProtocol: http2
  networkProtocol: TCP
  servicePort: 8082
  containerPort: 8082
  isIngressPort: false
```

- `appProtocol: http2` instructs Istio's sidecar to use h2c (HTTP/2 cleartext) when proxying to this container port
- `isIngressPort: false` because ingress is handled by the supplementary HTTPRoute, not the module-managed primary route

### HTTPRoute (`stigmer-cursor-bidi-path-route.yaml`)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: stigmer-cursor-bidi-path-route
  namespace: stigmer-prod
spec:
  parentRefs:
    - name: stigmer-service-external
      namespace: istio-ingress
      sectionName: https-external
  hostnames:
    - api.stigmer.ai
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /aiserver.v1
      backendRefs:
        - name: stigmer-service
          port: 8082
```

Gateway API longest-prefix-match semantics: `/aiserver.v1*` → port 8082, `/v1/proxy*` → port 8081, `/*` → port 80 (gRPC).

### Cluster state after apply

The Istio gateway controller accepted the route immediately:
- `Accepted: True` (route is valid)
- `ResolvedRefs: True` (backend service and port resolved)

## Benefits

- External runners (released desktop, CLI daemon) can now reach the BiDi proxy via `https://api.stigmer.ai/aiserver.v1.*`
- Same hostname, same TLS cert, same port 443 — no firewall issues from non-standard ports
- `appProtocol: http2` ensures Istio correctly handles bidirectional HTTP/2 streams through the mesh
- Pattern is consistent with the existing port 8081 routing — no new infrastructure concepts introduced

## Impact

- **Production routing**: HTTPRoute is live but will 503 until the next service deploy includes port 8082 in the container
- **No existing traffic affected**: No clients currently send requests to `/aiserver.v1*` paths
- **No overlay changes needed**: Prod and local overlays inherit the port from base automatically

## Related Work

- Previous: `2026-05-31-161735-netty-bidi-proxy-phase2-handler.md` (Task 1: Netty handler implementation)
- Previous: `2026-05-31-164807-bidi-proxy-local-dev-wiring.md` (Task 2: Local dev routing)
- Next: Task 4 — Wire released desktop app and remote runners
- Next: Task 5 — End-to-end validation with real Cursor API key

---

**Status**: Production Ready (routing deployed, pending next service redeploy for port to become active)
**Timeline**: ~15 minutes
