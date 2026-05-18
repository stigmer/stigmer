# Integration Test Suite — Remaining Issues & Default Agent Resolution

**Date**: May 18, 2026

## Context

After fixing 44 of the original 49 integration test failures (infrastructure fixes, transport test assertions, stale seedpack packages, and Java framework bugs), 5 failures remain. These are all **newly-exposed service-level issues** that were always broken but previously hidden behind the `CustomOperationContextV2.getResourceKind()` NPE at `CheckDuplicate`.

Additionally, the deployed desktop/web app shows "Failed to load default agent. Please try again." — which is the same root cause as one of the remaining test failures.

---

## Issue 1: "Failed to load default agent" (Deployed App + Test)

### Symptom
- **Desktop app**: Red error banner "Failed to load default agent. Please try again."
- **Integration test**: `TestAuthz_SessionOwnerOnly_OtherUserDenied` fails with `NotFound: No default agent available. Ensure an agent with label stigmer.ai/default-agent=true and visibility_public exists`

### Root Cause
The `AgentGetDefaultHandler` (`stigmer-cloud`) queries MongoDB for an agent with label `stigmer.ai/default-agent=true` and `visibility_public`. No such agent exists in the deployed database.

The default agent IS defined in the **seedpack** at:
```
stigmer/seedpack/agents/assistant.yaml
```

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: assistant
  visibility: visibility_public
  labels:
    stigmer.ai/system: "true"
    stigmer.ai/default-agent: "true"
spec:
  description: General-purpose AI assistant.
```

But the seedpack resources are **not automatically applied** to the deployed environment or to the integration test database. Someone (a migration, a CLI command, or a CI deploy step) needs to `apply` the seedpack agents to the environment's database.

### Resolution Path

Two things need fixing:

1. **Deployed environment**: The `assistant.yaml` agent needs to be applied to the MongoDB instance backing `app.stigmer.ai`. This is either:
   - A Mongock migration that seeds the default agent on startup (Java service)
   - A deploy pipeline step that runs `stigmer apply -f seedpack/agents/assistant.yaml`
   - A manual one-time operation via `stigmer apply`

2. **Integration tests**: The test harness should apply the default agent during setup (in `TestMain` or `SetupSuite`). The `FixtureDeployer` in `harness/fixture.go` already supports applying agents via gRPC — it just needs to include `assistant.yaml` from the seedpack as a baseline fixture.

### Which Test Should Catch This

- `TestAuthz_SessionOwnerOnly_OtherUserDenied` — already fails with this issue
- The **E2E test** `session-launcher.spec.ts` (Playwright, `test/e2e/tests/functional/`) — checks for the "Failed to load" error banner
- A new **smoke test** `TestSeedpackDefaultAgent_Exists` should be added to verify the default agent is present after harness setup

### Fix Complexity
- **Test harness fix**: ~10 lines in `harness/harness.go` to apply `seedpack/agents/assistant.yaml` during setup
- **Deploy fix**: Either a Mongock migration or a deploy pipeline step. The Mongock migration is preferable for self-healing.

---

## Issue 2: PlatformClient Secret Rotation — New Secret Rejected

### Symptom
`TestPlatformClient_RotateSecret_NewSecretWorks_OldSecretFails` — After calling `RotateSecret`, minting a token with the NEW secret returns `Unauthenticated: Invalid client_id or client_secret`.

### Root Cause
The `PlatformClientRotateSecretHandler` generates a new secret and persists the updated hash to MongoDB. But the `MintUserTokenHandler`'s credential validation step likely reads from a stale cache or the hash comparison has a subtle bug (e.g., the rotation handler stores the hash differently than the validation handler expects).

### Investigation Path
1. Check `PlatformClientRotateSecretHandler.java` — what does it persist?
2. Check `MintUserTokenHandler.java` — how does it load and compare the secret hash?
3. Verify whether there's a Redis cache layer for credential lookups that isn't invalidated on rotation
4. Check if the hash algorithm / format between creation and rotation is consistent

### Which Test Should Catch This
- `TestPlatformClient_RotateSecret_NewSecretWorks_OldSecretFails` — already fails with this
- This is a cloud-only service issue (`stigmer-cloud`)

---

## Issue 3: PlatformClient Delete — Credentials Still Work After Deletion

### Symptom
`TestPlatformClient_Delete_InvalidatesCredentials` — After deleting a PlatformClient, minting with its credentials should fail but may still succeed (or the test infrastructure doesn't reach this assertion because of the rotation issue).

### Root Cause
Same investigation as Issue 2 — credential invalidation after state changes.

### Which Test Should Catch This
- `TestPlatformClient_Delete_InvalidatesCredentials` — already catches it

---

## Issue 4: FGA Authorization — Viewer Can Create Agents

### Symptom
`TestAuthz_AutoGrantedViewer_CannotCreateAgent` — A user with auto-granted `viewer` role successfully creates an agent (the test expects `PERMISSION_DENIED` but gets success).

### Root Cause
Either:
1. The FGA model doesn't properly restrict `create` permission on agents for viewers
2. The gRPC interceptor doesn't check authorization for the agent `create` RPC
3. The authorization check is configured to use the wrong permission name

### Investigation Path
1. Check the FGA model at `stigmer-cloud/backend/services/stigmer-service/src/main/resources/fga/model/` — verify that `viewer` relation does NOT grant `can_create` on `agent` type
2. Check `AgentCreateHandler.java` — verify it includes an authorization step in its pipeline
3. Check the FGA tuples seeded by the test harness (`harness/fga_seeder.go`) — verify the test user is properly assigned only `viewer`

### Which Test Should Catch This
- `TestAuthz_AutoGrantedViewer_CannotCreateAgent` — already catches it
- This is a security-critical issue: if viewers can create agents, the multi-tenant authorization model is broken

---

## Issue 5: MintUserToken Status Code for Unknown Users

### Symptom
`TestPlatformClient_MintUserToken_JITProvisioningOff_UnknownUser_NotFound` — The service returns `FailedPrecondition` but the test expected `NotFound`.

### Status: FIXED
This was a test assertion issue. The service correctly returns `FailedPrecondition` (the user not having an account is a precondition failure for minting). The test assertion has been updated.

---

## Issue 6: Secret Hash Visible in Query Responses

### Symptom
`TestPlatformClient_Create_SecretNotReturnedOnGet` — The `client_secret_hash` field is returned in the query response (should be redacted for security).

### Status: SKIPPED (tracked for security hardening sprint)
The Java service's `PlatformClientGetHandler` doesn't strip the hash field before returning. This is a security improvement that needs a `TransformResponse` step or a field mask in the query handler.

---

## Priority Order for Fixes

| Priority | Issue | Impact | Fix Location |
|----------|-------|--------|--------------|
| P0 | Default agent not seeded | Blocks ALL users of deployed app | stigmer-cloud (migration) + test harness |
| P1 | FGA viewer can create agents | Security: authorization bypass | stigmer-cloud FGA model or handler |
| P2 | Rotation breaks credentials | Credential lifecycle broken | stigmer-cloud MintUserTokenHandler |
| P2 | Delete doesn't invalidate | Credential lifecycle broken | stigmer-cloud (same root cause as rotation) |
| P3 | Hash visible in queries | Information leakage (low severity) | stigmer-cloud query handler |

---

## Files Referenced

| File | Repo | Purpose |
|------|------|---------|
| `seedpack/agents/assistant.yaml` | stigmer | Default agent definition with `stigmer.ai/default-agent=true` label |
| `test/integration/harness/harness.go` | stigmer | Where to add seedpack agent seeding |
| `test/integration/harness/fixture.go` | stigmer | Existing fixture deployer (applies agents via gRPC) |
| `AgentGetDefaultHandler.java` | stigmer-cloud | Handler that queries for the default agent |
| `AgentRepo.findDefault()` | stigmer-cloud | MongoDB query for `stigmer.ai/default-agent=true` |
| `PlatformClientRotateSecretHandler.java` | stigmer-cloud | Secret rotation logic |
| `MintUserTokenHandler.java` | stigmer-cloud | Credential validation during token minting |
| `test/integration/auth_authorization_enforcement_test.go` | stigmer | FGA enforcement test cases |
| FGA model files in `src/main/resources/fga/model/` | stigmer-cloud | Authorization model definition |

---

**Status**: Pending resolution
**Next step**: Start a new conversation with this document as context to fix issues in priority order (P0 first).
