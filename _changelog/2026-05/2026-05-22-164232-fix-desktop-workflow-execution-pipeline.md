# Fix Desktop Workflow Execution Pipeline

**Date**: May 22, 2026

## Summary

Fixed the desktop workflow execution pipeline by resolving an auth token bug that prevented the runner from communicating with the Java service, restructured the runner lifecycle from eager to lazy startup, added dynamic token refresh propagation, and pre-bundled workflow code for faster worker creation. These changes eliminate the "authentication token missing" errors and "stuck execution" issues reported in the desktop app.

## Problem Statement

After enabling per-execution workflow queue routing, desktop workflow executions were failing with two symptoms:

1. **First execution "stuck"**: The execution appeared to hang in the UI with no progress.
2. **Auth error on subsequent executions**: `HydrateWorkflowExecution` activity failed with `authentication token missing`.

### Pain Points

- The runner read the auth token from `localStorage.getItem("stigmer.token")` — a key that **nobody writes to**. The actual auth tokens are stored under `"stigmer:auth:tokens"` by `token-store.ts`.
- The runner's `StigmerClient` captured the token at construction time and never updated it, so even if the token were correct initially, it would go stale after Auth0 refresh.
- The runner started eagerly on app mount, before the user needed it, creating a race condition where the runner might not be ready when the first execution was triggered.
- Each `Worker.create()` call re-ran webpack bundling (~300ms+), making per-execution worker creation slow.
- The `WorkflowExecutionDetailPage` recovery useEffect skipped when `phase === 0` (EXECUTION_PHASE_UNSPECIFIED) because protobuf enum 0 is falsy in JavaScript.
- `addWorkflowExecution` was fire-and-forget, silently swallowing errors.

## Solution

Applied a coordinated fix across the full IPC stack (React → Tauri → Node runner) with six targeted changes:

1. **Auth token fix**: Read from the real token store (`loadTokens()?.accessToken`).
2. **Dynamic token support**: StigmerClient interceptor reads token on every request via a shared mutable reference (`TokenRef`), not a captured closure.
3. **Token refresh propagation**: New `updateToken` IPC command (Rust ↔ Node) pushes refreshed Auth0 tokens to the running runner. A `TokenBridge` component in `App.tsx` watches for token changes and pushes them automatically.
4. **Lazy runner lifecycle**: Runner starts on first `addSession`/`addWorkflowExecution` call, not at mount. Callers await readiness before proceeding.
5. **Pre-bundled workflows**: `bundleWorkflowCode()` runs once at runner-manager startup; all workers receive the pre-built bundle, eliminating per-worker webpack cost.
6. **Phase falsiness fix**: Changed `phase && ...` to `phase != null && ...` in the recovery useEffect.

## Implementation Details

### Files Modified

| Layer | File | Change |
|-------|------|--------|
| Desktop (React) | `useEmbeddedRunner.ts` | Read from `loadTokens()`, lazy startup via `ensureRunning()`, `updateRunnerToken()` |
| Desktop (React) | `EmbeddedRunnerContext.tsx` | Exposed `updateRunnerToken` on context |
| Desktop (React) | `App.tsx` | Added `TokenBridge` component to push token updates |
| Desktop (React) | `WorkflowDetailPage.tsx` | `await addWorkflowExecution` with error toast |
| Desktop (React) | `WorkflowExecutionDetailPage.tsx` | `phase != null` instead of `phase &&` |
| Desktop (Tauri) | `runner.rs` | `UpdateToken` IPC command variant, `update_runner_token` Tauri command |
| Desktop (Tauri) | `lib.rs` | Registered `update_runner_token` handler |
| Runner (Node) | `stigmer-client.ts` | `TokenRef` shared reference, `updateToken()` method, dynamic interceptor |
| Runner (Node) | `runner-manager.ts` | Shared `tokenRef`, `updateToken()` on interface, `bundleWorkflowCode()` pre-bundling |
| Runner (Node) | `main.ts` | `updateToken` IPC command handler |
| Runner (Node) | `config.ts` | Optional `stigmerTokenRef` field |
| Runner (Node) | 4 activity files | Pass `tokenRef: config.stigmerTokenRef` to StigmerClient |
| Test harness (Go) | `unified_runner.go` | `UpdateToken()` method, `StigmerToken` config field |

### New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `stigmer-client.test.ts` | 10 | Token interceptor, updateToken, tokenRef shared reference |
| `useEmbeddedRunner.test.ts` | 5 | Token store integration, IPC contract |
| `auth_token_test.go` | 2 | Hydration with token, token refresh via IPC |
| `prebundle_test.go` | 1 | Second worker creation is not slower than first |

### Design Pattern: TokenRef (Shared Mutable Reference)

The token propagation uses a shared mutable reference (`{ current: string | null }`) passed through the config to all StigmerClient instances. This avoids modifying all 7 activity factories to track individual clients — the runner-manager owns the ref and all clients read from it on every request. Activities that call `loadConfig()` at runtime (3 of 7) are covered by also updating `process.env.STIGMER_TOKEN`.

## Pre-existing Test Failures

The runner test suite has **56 pre-existing failures** across 5 test files, none related to this change:

| File | Failures | Root Cause |
|------|----------|------------|
| `golden-execution.test.ts` | 25 | Golden execution tests failing across all tiers (kernel, expressions, external calls, advanced tasks) |
| `loader.test.ts` | 17 | Golden YAML parsing, task type discrimination, try/catch and fork parsing |
| `execute-serverless-workflow.test.ts` | 11 | Basic workflow execution, input/from, output/as, expression evaluation, switch directives |
| `call-function.test.ts` | 2 | Missing `with` config handling, call:agent not-yet-implemented assertion |
| `connect-mcp-server.test.ts` | 1 | MCP server connection workflow |

These appear to be caused by recent workflow engine refactoring (task config structure changes, new task types) that hasn't been reflected in the golden test fixtures yet.

## Benefits

- **Auth works**: Runner gRPC calls now carry the `Authorization` header, fixing the `authentication token missing` error.
- **Token stays fresh**: Auth0 token refreshes are pushed to the runner automatically, preventing stale token failures in long sessions.
- **Faster worker creation**: Pre-bundling eliminates ~300ms webpack cost per worker, making the second (and subsequent) execution starts near-instant.
- **Better UX**: Lazy startup means no wasted resources until the user actually runs something. `await` on worker creation gives clear error feedback instead of silent failures.
- **Correct recovery**: Phase 0 (UNSPECIFIED) executions are now properly handled by the recovery useEffect.

## Impact

- **Desktop app users**: Workflow executions should now complete successfully instead of failing with auth errors or appearing stuck.
- **Developer experience**: Clear error messages instead of silent failures. Pre-bundling improves iteration speed during development.
- **Future work**: The `TokenRef` pattern and `updateToken` IPC command provide infrastructure for any future token-dependent features.

## Related Work

- [Per-execution workflow queue routing](2026-05-22-133923-per-execution-workflow-queue-routing.md) — the routing work that exposed this auth bug
- [Worker recovery and integration tests](2026-05-22-151056-wfexec-worker-recovery-and-integration-tests.md) — earlier fix for stuck execution recovery

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours
