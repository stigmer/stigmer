# Fix Runner Stigmer Backend Endpoint Configuration

**Date**: May 22, 2026

## Summary

Fixed the desktop runner's stigmer backend endpoint configuration to read from `VITE_STIGMER_SIDECAR_ENDPOINT` instead of hardcoding `localhost:7234`. The runner's `HydrateWorkflowExecution` activity was failing with `ECONNREFUSED` because it was connecting to the Go OSS server's default port instead of the Java service's proxy endpoint.

## Problem Statement

When the desktop runner's child workflow (`stigmer/workflow/execute-from-execution`) was picked up by the worker, the first activity — `HydrateWorkflowExecution` — made a gRPC call to the stigmer backend to fetch the full workflow context. This call failed with `ConnectError: [unavailable]` / `ECONNREFUSED` after 3 retry attempts, causing the child workflow to fail.

### Pain Points

- Workflow executions triggered from the desktop app failed immediately on hydration
- The runner defaulted to `http://localhost:7234` (Go stigmer-server port) but the dev setup runs the Java service on port 8080 behind a proxy on port 9090
- The `temporalAddress` config already read from Vite env vars, but `stigmerEndpoint` did not follow the same pattern

## Solution

Updated `getRunnerConfig()` in `useEmbeddedRunner.ts` to read `stigmerEndpoint` from `import.meta.env.VITE_STIGMER_SIDECAR_ENDPOINT` first, matching the existing pattern used by `temporalAddress`.

## Implementation Details

The configuration cascade is now:

1. `VITE_STIGMER_SIDECAR_ENDPOINT` (compile-time Vite env var from `.env.development`)
2. `localStorage.getItem("stigmer.serverEndpoint")` (user override)
3. `"http://localhost:7234"` (OSS default fallback)

In dev mode, `.env.development` sets `VITE_STIGMER_SIDECAR_ENDPOINT=localhost:9090`, which the runner-manager's `normalizeEndpoint()` function automatically prefixes with `http://`.

## Benefits

- Workflow executions hydrate successfully against the local dev server
- Configuration pattern is now consistent between `stigmerEndpoint` and `temporalAddress`
- Production builds still use the correct endpoint via `.env.production`

## Impact

- **Desktop app**: Runner activities (hydration, status updates, artifact storage) now reach the correct backend in all environments

## Related Work

- Fix IPC field name serialization mismatch (May 22, 2026)
- Workflow Execution Worker Recovery (May 22, 2026)

---

**Status**: ✅ Production Ready
