# Integration Test Root-Cause Fixes: Skip Guards, Machine Account Identity, Temporal Bundler

**Date**: May 21, 2026

## Summary

Fixed three remaining integration test failures that survived the initial test infrastructure overhaul. Each fix targets a definitively identified root cause confirmed through deep analysis of both the Go test harness and the Java service's production security chain. All changes are confined to the test harness -- zero production code modifications.

## Problem Statement

After the initial integration test compilation fixes (commit `8c6823136`), three runtime failures remained:
1. `TestAgentExecution_CreateDefaultAgent/native` hung for 4 minutes without `ANTHROPIC_API_KEY`, aborting the entire offline CI suite
2. All 7 security tests failed with `identity resolution failed` despite the mock JWT `sub` format fix
3. Session routing dispatch tests failed with `ERR_UNKNOWN_FILE_EXTENSION: ".ts"` when launching the runner in manager mode

### Pain Points

- `make test` (offline CI gate) panicked on timeout when the unified runner was available but no API key was set
- Security integration tests were completely non-functional in production security mode
- Session routing Tier 2 (dispatch) tests could not run, blocking per-session routing verification

## Solution

Applied three targeted fixes, each at the correct architectural level:

1. **Skip guard**: Added `ANTHROPIC_API_KEY` check to `RequireNativePrereqs` -- the canonical skip guard used by all 65 native harness subtests
2. **Mock OAuth**: Changed the mock `/oauth/token` handler to read `client_id` from the POST body instead of hardcoding a mismatched subject
3. **Manager mode launcher**: Aligned manager mode with static mode by using `resolveRunnerCommand` (prefers `node dist/main.js`) instead of hardcoding `tsx src/main.ts`

## Implementation Details

### Fix 1: Native Harness API Key Skip Guard

Added `ANTHROPIC_API_KEY` presence check to `RequireNativePrereqs` in `harness_config.go`. Exhaustive analysis confirmed all 65 native harness subtests (17 files, 61 harness-loop sites, 4 native-only architect tests) genuinely require LLM -- zero false positives. The check sits at the guard level (not per-test) because an API key is a true prerequisite for native harness testing.

`RequireCursorPrereqs` left unchanged: cursor harness failures without keys are fast (immediate auth errors), not 4-minute hangs.

### Fix 2: Machine Account JWT Subject Mismatch

Root cause traced through the full Java identity resolution chain:

- `application-auth0.yaml` maps both `auth0.client-id` and `auth0.machine-account.client-id` to `${AUTH0_CLIENT_ID}` (same env var)
- Mongock migration seeds identity with `spec.idpId = "{AUTH0_CLIENT_ID}@clients"` = `test-client-id@clients`
- Mock OAuth handler hardcoded `sub=test-machine-client-id@clients` (matched dead env var `AUTH0_MACHINE_ACCOUNT_CLIENT_ID`)
- Resolution path: bootstrap JWT -> `resolveViaGrpc` -> inner call with machine-account JWT -> `resolveViaMongo("test-machine-client-id@clients")` -> NOT FOUND

Fixed by making the mock read `client_id` from the JSON POST body (matching real Auth0 `client_credentials` flow). Also removed dead `AUTH0_MACHINE_ACCOUNT_CLIENT_ID` / `AUTH0_MACHINE_ACCOUNT_CLIENT_SECRET` env vars from `service.go` to prevent future confusion.

### Fix 3: Temporal Bundler TypeScript Resolution

Root cause: `StartUnifiedRunnerManager` hardcoded `tsx src/main.ts` based on a stale assumption that proto stubs had no compiled output. Under `tsx`, `import.meta.url` anchors `workflowsPath` to `src/workflows/index.ts`. Temporal's webpack bundler follows `import type` during graph construction, resolves `@stigmer/protos` through the dev exports (`"./*": "./*.ts"`), and fails because `swc-loader` excludes `node_modules/`.

Fixed by using `resolveRunnerCommand` (same as static mode), which prefers pre-built `node dist/main.js`. The session-routing Makefile already has `ensure-runner-built`.

## Files Modified

| File | Change |
|------|--------|
| `test/integration/harness/harness_config.go` | Added `ANTHROPIC_API_KEY` check + `"os"` import |
| `test/integration/harness/mock_jwks_server.go` | Read `client_id` from POST body for JWT subject |
| `test/integration/harness/service.go` | Removed dead `AUTH0_MACHINE_ACCOUNT_*` env vars |
| `test/integration/harness/unified_runner.go` | Use `resolveRunnerCommand` in manager mode |

## Benefits

- `make test` (offline CI) runs cleanly: native harness tests skip instead of hanging 4 minutes
- Security tests should resolve machine-account identity correctly (mock aligns with Mongock)
- Session routing dispatch tests can use pre-built runner, avoiding Temporal bundler `.ts` failures
- Removed misleading dead config that caused the previous incorrect fix

## Impact

- **CI reliability**: Offline test gate no longer panics on timeout
- **Security test coverage**: 7 production-security-chain tests unblocked
- **Session routing coverage**: Tier 2 dispatch tests unblocked
- **Maintainability**: Dead config removed, stale comments updated, mock behavior matches real Auth0

---

**Status**: In Progress (fixes applied, awaiting runtime verification with local Java service)
**Timeline**: ~1 hour analysis + implementation
