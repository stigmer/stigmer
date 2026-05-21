# Integration Test Suite Session 3 — Systemic Root Cause Fixes

**Date**: May 22, 2026

## Summary

Resolved six systemic issues across the integration test infrastructure that were causing 128+ test failures, suite timeouts, and runner startup crashes. Deep investigation revealed the 128 failures clustered into just three root causes (not 128 independent issues). Security tests went from 7/8 to 8/8, workflow hydration failures eliminated, and the full offline suite can now execute within its timeout.

## Problem Statement

After sessions 1 and 2 brought the test suites from completely broken to mostly functional, four categories of failures remained:

### Pain Points

- ~49 cursor harness subtests failed deterministically with HTTP 502 because `RequireCursorPrereqs` didn't check for `CURSOR_API_KEY` (native harness correctly skipped)
- ~14 workflow tests failed with `ExecutionContext not found` during runner hydration — a ConnectError numeric code mismatch, not a missing provisioning step
- `TestPlatformClientJWT_MintAndUse` (security suite) failed because `IdentityAccountWhoAmIHandler` only looked up by `idpId`, which is null for PlatformClient tokens
- ~77 root tests never executed because the offline suite hit its 300s timeout
- E2E runner couldn't start because `server-manager.ts` launched via `tsx src/main.ts` after proto exports changed to compiled JS

## Solution

Each issue had a distinct root cause requiring a targeted fix. No architectural changes — each fix addresses the specific gap.

## Implementation Details

### Fix 1: Cursor harness `CURSOR_API_KEY` skip guard

`RequireCursorPrereqs` checked runner availability but not `CURSOR_API_KEY`. Every cursor harness test dispatches through the Cursor proxy, which returns HTTP 502 without a key. Added the environment check, mirroring `RequireNativePrereqs` which already checks `ANTHROPIC_API_KEY`.

**File**: `test/integration/harness/harness_config.go`

### Fix 2: ConnectError numeric code handling in runner activities

The `fetchAndFlattenEnv` function in `hydrate-workflow-execution.ts` checked for string error codes (`"not_found"` / `"NOT_FOUND"`), but Connect-RPC throws `ConnectError` with numeric `Code.NotFound` (5). The correct pattern already existed in `execute-cursor/env-resolver.ts` (`code === 5`). The same bug existed in `execute-deep-agent/environment.ts`.

Java intentionally skips ExecutionContext creation when the merged environment is empty (common for simple workflow tests with no env vars). The runner must handle NOT_FOUND gracefully — this was the design intent, just broken by the wrong error code check.

**Files**: `backend/services/runner/src/activities/hydrate-workflow-execution.ts`, `backend/services/runner/src/activities/execute-deep-agent/environment.ts`, plus corresponding unit test mocks updated to use numeric codes

### Fix 3: PlatformClient WhoAmI handler (stigmer-cloud)

`IdentityAccountWhoAmIHandler.LookupIdentityAccount` only called `findByIdpId()`. PlatformClient tokens set `identityAccountId` (from the verified JWT subject) but leave `idpId` null by design. Updated to prefer `identityAccountId` when available, falling back to `idpId` for Auth0/federated/API-key callers.

**File**: `stigmer-cloud: IdentityAccountWhoAmIHandler.java`

### Fix 4: Offline suite timeout increase

The offline test target used `-timeout 300s` but with ~266 root test functions plus infrastructure startup, the suite consistently timed out. Increased to 900s (matching provider-backed targets).

**File**: `test/integration/Makefile`

### Fix 5: E2E runner startup — switch to compiled JS

Ported the integration harness pattern to the E2E server manager: launch via `node dist/main.js` instead of `tsx src/main.ts`, with existence check and error diagnostics. Added shared `ensure-protos-built` / `ensure-runner-built` targets to the root Makefile, wired as prerequisites for `test-e2e-interactive` and `test-e2e-all`.

**Files**: `test/e2e/fixtures/server-manager.ts`, `Makefile`

## Benefits

- **Security**: 8/8 tests passing (was 7/8) — PlatformClient JWT WhoAmI now works
- **Core integration**: ~49 cursor failures eliminated by skip guard, ~14 workflow failures eliminated by ConnectError fix
- **Suite completeness**: ~77 previously-untested tests now reachable with 900s timeout
- **E2E**: Runner startup fixed, build prerequisites automated
- **Session routing**: 10/10 maintained (no regression)

## Impact

- The offline CI gate (`make test-integration`) will no longer have false failures from cursor harness tests or workflow hydration errors
- `TestPlatformClientJWT_MintAndUse` validates the full PlatformClient auth chain for the first time
- E2E interactive tests can now start the runner without manual build steps

## Related Work

- Previous session: integration test suite fixes (`2026-05-21-221545`)
- Previous session: four failure fixes (`2026-05-22-012138`)
- Workstream A: TS hydration activity (`2026-05-21-164357`)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
