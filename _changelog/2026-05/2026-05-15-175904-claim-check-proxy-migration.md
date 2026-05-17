# Claim Check Proxy Migration

**Date**: May 15, 2026

## Summary

Migrated the workflow-runner's claim check storage from direct Cloudflare R2 access to presigned URLs via the Stigmer Side-Channel Proxy. This eliminates R2 credentials from the workflow-runner deployment, bringing it in line with agent-runner and cursor-runner which already use the proxy for all cloud storage needs.

## Problem Statement

The workflow-runner accessed Cloudflare R2 directly using `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for the claim check pattern (offloading large Temporal payloads >50KB to object storage). This was the last runner with direct cloud storage credentials.

### Pain Points

- Workflow-runner required R2 secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) in its pod — security concern for platform-owned keys
- Inconsistent pattern: agent-runner and cursor-runner use the proxy, but workflow-runner bypassed it for storage
- No FGA authorization on claim check storage operations
- R2 bucket/endpoint config duplicated between workflow-runner and infrastructure

## Solution

Added a `"proxy"` storage type to the existing claim check `ObjectStore` abstraction. When `STIGMER_PROXY_ENDPOINT` is set (cloud mode), the workflow-runner requests presigned URLs from a new `/v1/proxy/claimcheck/` endpoint on the Stigmer service, then uses plain HTTPS for the actual R2 upload/download. In OSS mode (no proxy endpoint), the existing direct R2 path is unchanged.

## Implementation Details

### Go Side (workflow-runner)

**New `ProxyStore`** (`pkg/claimcheck/proxy_store.go`): Implements the `ObjectStore` interface using presigned URLs. Workflow execution ID is injected via `context.Context` (extracted from Temporal's `activity.GetInfo()`) and sent as `X-Stigmer-Workflow-Execution-Id` header for FGA authorization.

**Updated `Config`** (`pkg/claimcheck/store.go`): Added `ProxyEndpoint` and `ProxyAuthToken` fields. `StorageType` now supports `"proxy"` alongside `"r2"` and `"filesystem"`.

**Updated `Manager`** (`pkg/claimcheck/manager.go`): Added `"proxy"` case in `NewManager()`. `OffloadActivity` and `RetrieveActivity` now call `enrichContextFromActivity()` to inject the workflow execution ID from the Temporal activity context before storage operations.

**Updated worker config** (`worker/config/config.go`): Auto-detects proxy mode when `STIGMER_PROXY_ENDPOINT` is set. R2 credential validation is skipped in proxy mode (only `STIGMER_TOKEN`/`STIGMER_API_KEY` is required).

### Deployment

**Cleaned up prod overlay** (`_kustomize/overlays/prod/service.yaml`): Removed `R2_BUCKET`, `R2_ENDPOINT`, `R2_REGION`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `CLAIMCHECK_TTL_DAYS`. Added `STIGMER_PROXY_ENDPOINT`. `CLAIMCHECK_ENABLED` and `CLAIMCHECK_THRESHOLD_BYTES` remain (client-side decisions).

## Benefits

- **Unified runner pattern**: All three runners (agent, cursor, workflow) now follow the same proxy-based storage pattern in cloud mode
- **Eliminated R2 secrets**: Workflow-runner pod no longer needs direct R2 credentials
- **FGA authorized**: Claim check storage operations are now subject to OpenFGA authorization via `workflow_execution` scoping
- **Backward compatible**: OSS direct-R2 mode is unchanged; proxy mode is auto-detected via `STIGMER_PROXY_ENDPOINT`

## Impact

- **Workflow-runner**: Gains proxy-based claim check storage for cloud deployments
- **Security**: Platform-owned R2 credentials stay server-side in the Stigmer service; runners only see Stigmer tokens
- **Cloud operations**: One fewer secret to manage per workflow-runner deployment

## Related Work

- LLM proxy integration (same session, earlier today — `LlmProxyConfig` pattern)
- Agent-runner artifact proxy (`ProxyArtifactStorage` in `worker/storage/proxy.py`)
- Java-side `ClaimCheckProxyController` + R2 config (stigmer-cloud repo, paired with this change)

---

**Status**: Production Ready (Go side) / Production Ready (Java side, pending deployment)
**Timeline**: ~1 hour implementation
