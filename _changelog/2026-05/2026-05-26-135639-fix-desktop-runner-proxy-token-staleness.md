# Fix Desktop Runner Proxy Token Staleness and Startup Noise

**Date**: May 26, 2026

## Summary

Fixed a token staleness bug in the fetch interceptor that caused "Cursor run failed" errors on the desktop (Tauri) embedded runner after Auth0 JWT refresh. The fetch interceptor froze the JWT at startup and never updated it when the token was refreshed via IPC, causing REST-path Cursor SDK calls to fail through the proxy with a stale Bearer token. Also eliminated duplicate `WORKSPACE_ROOT_DIR` warnings, added a startup diagnostic banner, and ensured the desktop always provisions a workspace directory.

## Problem Statement

Desktop workflow executions were failing with the opaque error `"Cursor run failed"` after the runner had been running for some time. The Cursor SDK returned `{ status: "error", result: undefined }` with no diagnostic detail. Executions that worked initially would start failing after the Auth0 JWT expired, with no visible correlation in the logs.

### Pain Points

- The fetch interceptor's `interceptorConfig.stigmerToken` was frozen at startup and never updated when `updateToken` IPC arrived
- Connect RPC calls (via `CURSOR_API_BASE_URL`) used the live `tokenRef.current` and worked fine after token refresh
- REST calls via fetch (token exchange, `/v1/models`) used the frozen interceptor token and silently failed with 401 from the Java proxy
- `WORKSPACE_ROOT_DIR` warning printed twice per process start due to double `loadConfig()` call in `main.ts`
- Desktop Tauri launcher never set `WORKSPACE_ROOT_DIR`, relying on the runner's fallback path

## Solution

Four targeted fixes across the runner and desktop app:

1. **Token propagation**: Added `updateInterceptorToken()` to the fetch interceptor and wired it into the runner-manager's `updateToken()` IPC handler
2. **Single config load**: Refactored `main.ts` to call `loadConfig()` once and pass the result to mode-specific functions
3. **Startup banner**: Added a single structured log line on stderr with critical config state (mode, proxy, token, workspace, taskQueue)
4. **Desktop workspace**: Tauri `runner.rs` now always derives `~/.stigmer/desktop/workspace` when `workspace_root_dir` is not provided

## Implementation Details

### Files Modified

| File | Change |
|------|--------|
| `execute-cursor/fetch-interceptor.ts` | Added `updateInterceptorToken()` export |
| `runner-manager.ts` | Imported and called `updateInterceptorToken()` from `updateToken()` |
| `main.ts` | Single `loadConfig()` in `main()`, passed to `runManagerMode(config)` / `runStaticMode(config)`, startup banner |
| `desktop/src-tauri/src/runner.rs` | Always derive and set `WORKSPACE_ROOT_DIR` |

### Token Propagation Fix

The split-brain before this fix:

| SDK call path | Auth source | Updated on refresh? |
|---|---|---|
| Connect RPC (agent.send, stream) | `effectiveApiKey` from `tokenRef.current` | Yes |
| REST via fetch (token exchange, /v1/models) | `interceptorConfig.stigmerToken` | **No** |

After the fix, `updateToken()` updates all three auth sinks: `tokenRef.current`, `process.env.STIGMER_TOKEN`, and `interceptorConfig.stigmerToken`.

### Desktop Workspace Fix

When `workspace_root_dir` is not provided in the config (the normal desktop case), Tauri now derives `~/.stigmer/desktop/workspace`, creates it, and passes it as `WORKSPACE_ROOT_DIR`. This matches the CLI daemon pattern and eliminates the fallback warning from the Node runner's `resolveWorkspaceRootDir()`.

## Benefits

- **Root cause fix**: Fetch-intercepted REST calls now use the current JWT after token refresh, preventing silent 401 failures from the proxy
- **Clean startup logs**: Single diagnostic banner replaces duplicate verbose warnings, making proxy mode and token state immediately visible
- **No more fallback warnings**: Desktop always provisions a workspace directory, suppressing the noisy `WORKSPACE_ROOT_DIR` console.warn
- **Consistent env propagation**: All three token sinks stay in sync on every IPC `updateToken` call

## Impact

- **Desktop app**: Workflow executions that previously failed after JWT expiry should now succeed across token refreshes
- **Runner**: Cleaner startup output with actionable config summary
- **Debugging**: Enhanced error diagnostics (from prior session) now deploy with the rebuild

## Related Work

- Error diagnostics enhancement: `2026-05-26-125136-enhance-cursor-run-error-diagnostics.md`
- Workspace isolation: `2026-05-02-124838-cursor-runner-workspace-isolation.md`
- Legacy runner migration: `2026-05-21-153507-delete-legacy-runners-migrate-integration-harness.md`

---

**Status**: Production Ready
**Timeline**: Single session
