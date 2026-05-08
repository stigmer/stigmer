# Fix Sandbox Runner TLS Connection and Model Registry Authentication

**Date**: May 8, 2026

## Summary

Fixed two bugs that caused agent executions to fail in Daytona sandboxes. The cursor-runner's gRPC client connected with plain HTTP to a TLS port (ECONNRESET), and the model registry fetcher read the wrong environment variable for authentication (401 Unauthorized).

## Problem Statement

Agent execution through Cursor was failing with `EXECUTION_FAILED` status. Investigation of sandbox `9a246302-6034-48f9-afcb-7e37bde747e6` via the Daytona toolbox API revealed two distinct failures in the runner processes.

### Pain Points

- Every Cursor-based agent execution failed immediately with `ECONNRESET`
- `GenerateSessionSubject` activity failed because the model registry returned 401, causing the raw platform model name (`claude-sonnet-4.5`) to be passed to Anthropic's API, which rejected it as invalid

## Solution

Two targeted fixes addressing the root causes rather than symptoms:

1. **TLS detection in `normalizeEndpoint()`** — bare `host:443` endpoints now get `https://` instead of `http://`
2. **Environment variable alignment** — model registry reads `STIGMER_TOKEN` (what the sandbox launcher injects) with fallback to `STIGMER_AUTH_TOKEN` for backward compatibility

## Implementation Details

### cursor-runner `config.ts`

The `normalizeEndpoint()` function prepends a scheme when the `STIGMER_BACKEND_ENDPOINT` env var is a bare `host:port`. In prod, this value is `api.stigmer.ai:443` — a TLS gRPC endpoint. The function defaulted to `http://`, producing `http://api.stigmer.ai:443`. Connect-ES then opened a plain HTTP/2 connection to a TLS port, causing immediate connection resets.

Added a `:443` check before the `http://` default so port 443 correctly gets `https://`.

### graphton `model_registry.py`

The `_load_registry_text()` method read `STIGMER_AUTH_TOKEN` for the Bearer header, but the sandbox launcher (`DaytonaSandboxRunnerLauncher.buildEnvVars()`) injects the user JWT as `STIGMER_TOKEN`. The mismatch meant the auth header was never set, the proxy returned 401, the registry didn't load, and `resolve_or_passthrough()` fell through to passing the platform-friendly name (`claude-sonnet-4.5`) as the API model ID. Anthropic rejected it with 404 since the actual API model ID is `claude-sonnet-4-5-20250929`.

Changed to read `STIGMER_TOKEN` first, falling back to `STIGMER_AUTH_TOKEN`.

## Benefits

- Cursor-based agent executions in Daytona sandboxes will connect successfully to the backend
- Model registry loads with proper authentication, enabling correct model name resolution
- Session subject auto-generation works (economy-tier LLM call succeeds)

## Impact

- **cursor-runner**: All cloud-mode Cursor agent executions were broken; this restores them
- **agent-runner (Python)**: `GenerateSessionSubject` and any activity relying on model registry resolution was broken in cloud mode
- **Backward compatible**: `STIGMER_AUTH_TOKEN` is still accepted as a fallback

## Files Changed

| File | Change |
|------|--------|
| `backend/services/cursor-runner/src/config.ts` | `normalizeEndpoint()` — https for :443 |
| `backend/services/cursor-runner/src/__tests__/config.test.ts` | Test for port-443 TLS detection |
| `backend/libs/python/graphton/src/graphton/core/model_registry.py` | Read `STIGMER_TOKEN` with `STIGMER_AUTH_TOKEN` fallback |

## Related Work

- `72ee4891d` — migrate model registry from static JSON to authenticated API (introduced the env var)
- `75fc03582` — remove static model-registry.json from sandbox image

---

**Status**: ✅ Production Ready
