# Consolidate Side-Channel Proxy Under api.stigmer.ai

**Date**: April 21, 2026

## Summary

Replaced the planned `proxy.stigmer.ai` hostname with path-based routing on the existing `api.stigmer.ai` Gateway, eliminating 6 infrastructure resources (Gateway, Certificate, 2 HTTPRoutes, CORS EnvoyFilter) and adding 1 supplementary HTTPRoute. The proxy endpoints are now served under `api.stigmer.ai/v1/proxy/*` via Gateway API longest-prefix-match semantics.

## Problem Statement

The Phase 0 Side-Channel Proxy design created a separate `proxy.stigmer.ai` hostname to front the HTTP proxy endpoints (LLM passthrough, checkpointer, artifact storage) on port 8081. This required a dedicated DNS record, TLS certificate, Istio Gateway, HTTPRoutes, and CORS EnvoyFilter — all for a different port of the same pod that already has `api.stigmer.ai` routing to port 8080 (gRPC).

### Pain Points

- Separate hostname for a different port of the same service leaks an implementation detail (gRPC on Netty:8080 vs REST on Tomcat:8081) into the public DNS surface
- 6 new infrastructure resources for what is architecturally the same API surface
- DNS record creation, certificate provisioning, and Gateway API resources add operational overhead
- Runner needs two separate endpoint configurations (`STIGMER_BACKEND_ENDPOINT` + `STIGMER_PROXY_ENDPOINT`) pointing at the same backend

## Solution

Path-based routing on the existing `api.stigmer.ai` Gateway using a supplementary HTTPRoute. The KubernetesDeployment Pulumi module creates the primary HTTPRoute (`stigmer-service-https-external`) with `PathPrefix /` routing to port 80 (gRPC). A manually-managed supplementary HTTPRoute matches `/v1/proxy` and routes to port 8081 (HTTP proxy). Gateway API longest-prefix-match guarantees the more specific route wins.

This follows the established pattern of supplementary resources alongside module-managed ones — identical to how the CORS EnvoyFilter (`stigmer-service-gateway-cors.yaml`) already operates.

## Implementation Details

### OpenMCF KubernetesDeployment module analysis

Analyzed the Pulumi module (`ingress.go`) to confirm:
- Service correctly exposes both ports (80→8080 and 8081→8081)
- Deployment correctly includes both container ports
- Module hardcodes `PathPrefix /` with a single backend port — no path-based routing capability
- Gateway name follows `fmt.Sprintf("%s-external", target.Metadata.Name)` = `stigmer-service-external`
- Existing `isIngressPort: false` on `http-proxy:8081` is correct — module creates the Service port, supplementary HTTPRoute handles external routing

### Infrastructure changes (stigmer-cloud)

**Deleted** (4 files, never applied to cluster):
- `stigmer-proxy-gateway.yaml` — separate Istio Gateway for proxy.stigmer.ai
- `stigmer-proxy-httproute.yaml` — HTTP→HTTPS redirect + HTTPS route
- `stigmer-proxy-certificate.yaml` — cert-manager Certificate for proxy.stigmer.ai
- `stigmer-proxy-gateway-cors.yaml` — CORS EnvoyFilter for proxy.stigmer.ai

**Created** (1 file):
- `stigmer-proxy-path-route.yaml` — supplementary HTTPRoute: `api.stigmer.ai/v1/proxy` → `stigmer-service:8081`

**Modified**:
- `stigmer-service-gateway-cors.yaml` — added `x-api-key` to allowed headers (Anthropic SDK compatibility)
- `LlmProxyController.java` — updated Javadoc example URL

### Runner config changes (stigmer)

- `_kustomize/overlays/prod/service.yaml` — `STIGMER_PROXY_ENDPOINT` changed to `https://api.stigmer.ai`
- `worker/config.py` — updated docstring references
- `worker/storage/proxy.py` — updated module docstring
- `worker/checkpointer/http_saver.py` — updated module docstring

### Documentation updates (both repos)

- Updated all references to `proxy.stigmer.ai` across changelogs, project docs, and code comments
- Revised Phase 0 deploy task list: items 3 (DNS setup) and 5 (Planton secrets group) eliminated

## Benefits

- **6 infra resources eliminated, 1 added** — net reduction of 5 infrastructure resources
- **No DNS record needed** — proxy routes through the existing `api.stigmer.ai` hostname
- **No TLS certificate needed** — reuses the existing certificate managed by the Pulumi module
- **Simpler deploy** — `kubectl apply` of 1 HTTPRoute instead of 4 YAML files + DNS record
- **Unified API surface** — proxy endpoints are semantically part of the API, served under the same hostname

## Impact

- **Infrastructure** — significantly simplified: no new DNS, no new cert, no new Gateway
- **Agent-runner** — `STIGMER_PROXY_ENDPOINT` now points to `api.stigmer.ai` (same hostname as gRPC)
- **Phase 0 deploy** — 2 ops tasks eliminated (DNS setup, Planton secrets group), 1 simplified (1 HTTPRoute instead of 4 YAML files)

## Related Work

- Phase 0 proxy implementation: `_changelog/2026-04/2026-04-20-185017-side-channel-proxy-phase-0.md`
- Project: `_projects/2026-04/20260420.01.agent-runner-as-resource`
- OpenMCF module: `apis/org/openmcf/provider/kubernetes/kubernetesdeployment/v1/iac/pulumi/module/ingress.go`

---

**Status**: Production Ready (pending Phase 0 deploy)
