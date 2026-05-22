# Fix Runner FGA Authorization with Proper Stigmer JWT

**Date**: May 22, 2026

## Summary

Fixed the integration test FGA authorization failure where the unified runner's `updateStatus` calls were rejected with `permission_denied`. The test harness was passing a garbage token (`test-integration-key`) instead of a properly signed Stigmer JWT — causing the Java service to hit a fragile fallback path that behaved differently under connect-node's gRPC transport.

## Problem Statement

All 21 native agent execution tests failed because the runner could never update execution status. The error (`ConnectError: [permission_denied] unauthorized to update agent execution status`) appeared 884 times in Session 9 test logs.

### Pain Points

- Every `TestAgentExecution_*/native` test that expects `EXECUTION_COMPLETED` fails
- The unified runner can authenticate but gets denied by FGA authorization
- The test harness was relying on a fragile "invalid token → fallback identity" path instead of matching production behavior

## Solution

Made the test harness mint a proper Stigmer-signed JWT for the runner — exactly what `SandboxTokenService` does in production. This eliminates the fallback path entirely: the Java service verifies the JWT signature, extracts `sub=test-identity-account-id`, and the FGA authorization chain resolves correctly.

## Implementation Details

- **New file: `test/integration/harness/runner_token.go`** — Uses the same RSA PKCS#8 key (`STIGMER_JWT_SIGNING_KEY`) that the Java service uses to mint JWTs with `iss=stigmer`, `sub=test-identity-account-id`, `kid=stigmer-signing-key-1`. This is the test-harness equivalent of `SandboxTokenService.mintForSession()`.

- **Modified: `test/integration/harness/unified_runner.go`** — Calls `MintRunnerToken()` when setting `STIGMER_TOKEN` for the runner process, replacing the garbage `test-integration-key`.

- **New file: `test/integration/agent_execution_fga_diag_test.go`** — Diagnostic tests that verify the JWT-based auth works correctly for `updateStatus` and `cancel` operations.

## Benefits

- Runner auth in tests matches production behavior (proper JWT, not fallback)
- Eliminates 21 Category 1 test failures (permission_denied)
- Zero `permission_denied` errors in runner logs after the fix
- Makes the test harness less fragile (no dependency on Java fallback paths)

## Impact

- **Integration test suite**: 21 native subtests unblocked from FGA auth failure
- **Production code**: No changes — fix is entirely in test infrastructure
- **Remaining**: Tests now hit the separate Category 2 bug (`checkpoint.pending_sends is not iterable` in LangGraph's HttpCheckpointSaver)

## Related Work

- Session 9 integration test report (`_cursor/integration-test-session9-report.md`)
- `SandboxTokenService.java` in stigmer-cloud (production equivalent)
- `TestMachineAccountJwtProviderConfig.java` (similar pattern for machine account JWT)

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes diagnosis + fix
