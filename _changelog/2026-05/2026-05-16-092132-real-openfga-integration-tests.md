# Real OpenFGA Authorization in Integration Tests

**Date**: May 16, 2026

## Summary

Added real OpenFGA authorization to the integration test suite, replacing the permit-all `TestIamPolicyGrpcRepo` stub with a Testcontainer-managed OpenFGA instance that loads the production authorization model. The test infrastructure now exercises the same FGA check/write/list code paths that run in production, catching authorization model regressions that were previously invisible.

## Problem Statement

The integration test suite bypassed all FGA authorization using a permit-all stub (`TestIamPolicyGrpcRepo`). Every `checkAuthorization` call returned `true` unconditionally. Every `listAuthorizedResourceIds` call returned all documents from MongoDB. All policy write operations (`createPolicy`, `bootstrapPolicy`, `deletePolicy`, `cleanupResourcePolicies`) were no-ops.

### Pain Points

- The FGA authorization model (22 `.fga` type definition files across platform, IAM, tenancy, and agentic domains) was a living artifact with zero test coverage
- A change to any `.fga` relation, permission hierarchy, or condition would silently pass all tests
- Handler pipeline steps that write FGA tuples (`bootstrapPolicy`) were never exercised in tests
- The proxy authorization layer (`ProxyAuthorizationService`) was tested against a permit-all backend
- The gap between "tests pass" and "production authorization works" was growing with every model change

## Solution

Introduced an OpenFGA Testcontainer into the Go test harness that automatically starts when the FGA model directory (from the stigmer-cloud sibling repo) and the `fga` CLI are available. Decoupled the Auth0 authentication bypass from the FGA authorization bypass using a new `stigmer.fga.enabled` Spring property, so tests can use synthetic identity + real authorization simultaneously.

## Implementation Details

### Go Test Harness (stigmer OSS)

**`harness/openfga.go`** — OpenFGA Testcontainer lifecycle:
- Starts `openfga/openfga:v1.8.2` via `testcontainers-go/modules/openfga`
- Creates a store via the OpenFGA REST API
- Compiles the modular `.fga` files into JSON using `fga model transform --file fga.mod`
- Writes the authorization model via the REST API
- Exposes `WriteTuples()` for seeding relationship tuples

**`harness/fga_seeder.go`** — Base tuple seeding:
- Platform operator: `identity_account:test-identity-account-id → operator → platform:stigmer`
- Org owner: `identity_account:test-identity-account-id → owner → organization:test-org`

**`harness/harness.go`** — Auto-detection and graceful degradation:
- OpenFGA starts in the `Start()` parallel container phase when both prerequisites exist
- `FGAEnabled()` method for tests to query FGA availability
- Teardown in `Stop()` after the Java service shuts down

**`harness/service.go`** — Conditional env var wiring:
- When OpenFGA config is present: adds `openfga` Spring profile, sets `STIGMER_FGA_ENABLED=true`, passes `OPENFGA_API_URL/STORE_ID/MODEL_ID`
- When absent: tests run with permit-all bypass as before

### Spring Conditionals (stigmer-cloud)

**`TestIamPolicyGrpcRepo`**: Changed from `@ConditionalOnProperty(security.mode=test)` to `@ConditionalOnExpression` that checks both `security.mode=test` AND `fga.enabled != true`.

**`IamPolicyGrpcRepoImpl`**: Changed from `@ConditionalOnProperty(security.mode=production, matchIfMissing=true)` to `@ConditionalOnExpression` that activates when `security.mode=production` OR `fga.enabled=true`.

### FGA Model Regression Tests

5 dedicated test functions that validate the authorization model directly against OpenFGA without the Java service:

| Test | What It Validates |
|------|-------------------|
| `PlatformOperatorPermissions` | All 8 platform permissions + non-operator denial |
| `OrgOwnerHierarchy` | owner > admin > member > viewer role chain |
| `AgentOpenAccess` | All org members can view agents (open access pattern) |
| `SessionPersonalResource` | Only owner + explicit grants can view sessions |
| `AgentExecutionSessionInheritance` | Execution permissions inherited from parent session |
| `PublicVisibilityCondition` | Conditional `allow_public` wildcard behavior |

### CI Workflow

- Job 1 uploads the FGA model directory as an artifact alongside the JAR
- Job 2 installs the `fga` CLI and passes `STIGMER_FGA_MODEL_DIR` to the test harness

## Benefits

- Authorization model regressions are caught before merge — a broken `.fga` relation fails integration tests
- Handler pipeline `bootstrapPolicy` calls are exercised for real, catching missing tuple writes
- The proxy authorization path (`ProxyAuthorizationService → RequestAuthorizationService → IamPolicyGrpcRepo → OpenFGA`) is tested end-to-end
- No additional infrastructure cost: OpenFGA container is ~100MB, starts in <2s, runs alongside existing Mongo/Redis/Temporal containers
- Graceful degradation: tests still work without the `fga` CLI or model directory

## Impact

- **Integration test suite**: All existing tests continue to work. When FGA is available, authorization checks are real. When not, permit-all stub is used.
- **FGA model authors**: Model changes are now tested automatically. No separate validation step needed.
- **CI pipeline**: ~2-3s additional startup time for the OpenFGA container. The `fga` CLI install adds ~5s.
- **Local development**: Developers with `fga` CLI installed and stigmer-cloud checked out automatically get FGA-enabled tests.

## Related Work

- [OpenFGA Test Authorization Bypass](2026-05-14-130549-openfga-test-authorization-bypass.md) — the original permit-all bypass this work evolves
- [E2E Architecture Spike](2026-05-14-122325-e2e-architecture-spike-test-harness.md) — the test harness foundation
- [Proxy Auth Fix](2026-05-15-213619-fix-proxy-auth-for-integration-tests.md) — HTTP identity filter that makes FGA work for proxy requests

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1.5 hours)
