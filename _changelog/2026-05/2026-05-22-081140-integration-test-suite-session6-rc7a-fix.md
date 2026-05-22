# Integration Test Suite — Session 6: RC7a JIT Provisioning Fix

**Date**: May 22, 2026

## Summary

Fixed the remaining 7 integration test failures (RC7a) documented in the Session 5 changelog. The root cause was misdiagnosed in Session 5 — the failures were not FGA authorization errors but a combination of a production bug in `PlatformClientAccountProvisionerImpl` (metadata.name exceeding the 63-character resource name limit) and a missing machine account identity on the `inProcessChannelAsSystem` channel in test mode.

## Problem Statement

Session 5 left 7 tests failing with `MintUserTokenHandler/ResolveOrProvisionUser: Account provisioning failed` and attributed the cause to the `bootstrapPolicy` handler's `can_bootstrap_iam` authorization check failing because `inProcessChannelAsSystem` carries no machine account JWT in test mode.

### Actual Root Causes (corrected from Session 5 analysis)

**Root Cause 1 — metadata.name validation failure (production bug):** The `PlatformClientAccountProvisionerImpl.provisionAccount()` sets `metadata.name` to either the user's email or external user ID. The integration test user IDs include Go test function names (e.g., `viewer-list-pc-TestAuthz_AutoGrantedViewer_CanListPlatformClients@test.stigmer.ai`), exceeding the 63-character Kubernetes-style name limit enforced by protobuf validation on `ApiResourceMetadata.name`. This same bug would affect any production platform builder passing long email addresses.

**Root Cause 2 — missing machine identity on system channel:** In test mode (`STIGMER_SECURITY_MODE=test`), the `MachineAccountJwtProvider` is not loaded (guarded by `@ConditionalOnProperty(havingValue = "production")`). The `InProcessMachineAccountTokenInjectorInterceptor` becomes a no-op, so system channel calls carry no identity. The `testCallerIdentityInterceptor` falls back to `test-identity-account-id`, conflating the test user identity with the system identity. This caused `grantOrgRole()` (which requires `can_grant_access` on the org) to silently fail because the synthetic test identity happened to have org owner — but the machine account identity (which should be the caller for system operations) did not.

## Solution

Three targeted fixes addressing both root causes plus the architectural gap:

## Implementation Details

### Fix 1: Truncate metadata.name in provisioner (stigmer-cloud)

In `PlatformClientAccountProvisionerImpl.provisionAccount()`, the `metadata.name` is now truncated to 63 characters before creating the `IdentityAccount`. This is a production bug fix — platform builders with long email addresses would hit the same validation error.

### Fix 2: Test-mode machine account identity (stigmer-cloud)

Three files work together to give `inProcessChannelAsSystem` a proper, dedicated machine identity in test mode:

1. **`IntegrationTestDataSeeder.java`** — Seeds a machine account document (`test-machine-account-id`) in MongoDB at startup, mirroring what the production Mongock migration `U20250102_InsertBootstrapIdentityAccounts` does.

2. **`TestMachineAccountJwtProviderConfig.java`** (new) — A `@ConditionalOnProperty(havingValue = "test")` configuration that provides a `MachineAccountJwtProvider` bean. Instead of calling Auth0, it mints Stigmer-signed JWTs (using the same RSA key pair as `StigmerJwtIssuer`) with `sub = test-machine-account-id`. This makes `InProcessMachineAccountTokenInjectorInterceptor` functional in test mode.

3. **`IntegrationTestSecurityConfig.java`** — The `testCallerIdentityInterceptor` now recognizes machine account JWTs: when a verified Stigmer JWT has `sub = test-machine-account-id`, it sets `isMachineAccount = true` and uses the machine account's idpId (`test-machine@clients`).

### Fix 3: FGA tuples for machine account (stigmer OSS)

`SeedBaseFGATuples` now seeds two additional tuples for the machine account:
- `identity_account:test-machine-account-id` → `operator` on `platform:stigmer` (grants `can_bootstrap_iam`)
- `identity_account:test-machine-account-id` → `admin` on `organization:test-org` (grants `can_grant_access` for auto-grant operations)

## Files Changed

### stigmer-cloud

| File | Change |
|------|--------|
| `backend/.../provisioning/PlatformClientAccountProvisionerImpl.java` | Truncate `metadata.name` to 63 chars (production bug fix) |
| `backend/.../config/test/IntegrationTestDataSeeder.java` | Seed machine account MongoDB document |
| `backend/.../config/test/TestMachineAccountJwtProviderConfig.java` | **New** — test-mode `MachineAccountJwtProvider` using Stigmer JWT signing |
| `backend/.../config/test/IntegrationTestSecurityConfig.java` | Recognize machine account JWTs as `isMachineAccount=true` |

### stigmer (OSS)

| File | Change |
|------|--------|
| `test/integration/harness/fga_seeder.go` | Add machine account operator + org admin tuples |

## Impact

- **7/7 tests now pass** — all RC7a failures resolved
- **51/51 integration tests pass** — combined with Session 5's 44/51 fixes, the full suite is green
- **Production bug fixed** — `PlatformClientAccountProvisionerImpl` no longer fails on long email addresses
- **Architectural gap closed** — `inProcessChannelAsSystem` now has a proper, dedicated machine identity in test mode, matching production behavior
- No changes to production code paths (except the metadata.name truncation, which is a correctness fix)

## Related Work

- Session 5: `_changelog/2026-05/2026-05-22-032331-integration-test-suite-session5-fixes.md`
- Session 4 (triage): `_changelog/2026-05/2026-05-22-025000-integration-test-suite-session4-failure-report.md`

---

**Status**: 51/51 Integration Tests Passing
**Timeline**: ~30 minutes for diagnosis + implementation + verification
