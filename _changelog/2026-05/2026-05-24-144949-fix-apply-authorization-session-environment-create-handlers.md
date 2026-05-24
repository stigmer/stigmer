# Fix Apply Authorization in Session and Environment Create Handlers

**Date**: May 24, 2026

## Summary

Fixed authorization failure when `apply` delegates to `SessionCreateHandler` or `EnvironmentCreateHandler` on the cloud Java backend. Both handlers were using the generic `commonSteps.authorize` step which doesn't handle the `apply` method metadata remapping — replaced with `createSteps.authorize` which has apply-aware logic.

## Problem Statement

After switching the runner's `CallAgent` activity from `createSession()` to `applySession()` (for idempotent session recovery), workflow executions immediately failed with:

```
Authorization config not found in method options for method ai.stigmer.agentic.session.v1.SessionCommandController/apply
```

The `apply` RPC intentionally has no proto auth options — authorization is delegated to the underlying `create` or `update` handler. But when apply delegates to `SessionCreateHandler`, the gRPC interceptor context still carries method name `apply`, and the generic authorize step can't find auth config for it.

### Pain Points

- All workflow executions with `agent_call` tasks immediately fail on the cloud backend
- The error occurs on the very first attempt (not a recovery scenario) since `applySession` is now the default path
- `EnvironmentCreateHandler` has the same latent bug — would fail if environment `apply` is ever called

## Solution

Replaced `commonSteps.authorize` (`AuthorizeRequestStepV2`) with `createSteps.authorize` (`CreateOperationAuthorizeStep`) in both affected handlers. The `CreateOperationAuthorizeStep` has apply-aware logic that detects when the incoming method is `apply` and remaps to the `create` method's auth config via `RequestMethodMetadataRegistry`.

## Implementation Details

### Audit Results

Audited all 19 `*CreateHandler.java` files in stigmer-cloud. Only 2 were affected:

| Handler | Issue |
|---------|-------|
| `SessionCreateHandler` | Actively failing — blocking all workflow executions |
| `EnvironmentCreateHandler` | Latent — would fail if environment apply is called |

The other 17 handlers were already correct: 6 use `createSteps.authorize`, 7 use custom auth, 4 have no auth step (by design).

### Changes (stigmer-cloud)

- **`SessionCreateHandler.java`**: `.addStep(commonSteps.authorize)` → `.addStep(createSteps.authorize)`
- **`EnvironmentCreateHandler.java`**: Same change

Both handlers already inject `CreateOperationSteps<T>` and use it for `checkDuplicate`, `buildNewState`, `persist`, and `createAuthorizationTuples` — so `createSteps.authorize` was already available with no new dependencies.

## Benefits

- Workflow executions with `agent_call` tasks now work correctly on cloud via `applySession()`
- Environment apply (if/when exercised) will also authorize correctly
- Aligns both handlers with the established pattern used by `WorkflowCreateHandler`, `AgentCreateHandler`, `ProjectCreateHandler`, `OAuthAppCreateHandler`, `IdentityProviderCreateHandler`, and `InvitationCreateHandler`

## Impact

- **Immediate**: Unblocks all workflow executions that use the `applySession()` path (the runner's new default)
- **Preventive**: Fixes latent bug in environment create authorization before it manifests

## Related Work

- `2026-05-24-134907-fix-workflow-session-recovery-idempotency.md` — Introduced `applySession()` in the runner, which exposed this auth gap
- `stigmer-cloud/_changelog/2026-03/2026-03-23-095756-fix-organization-apply-already-exists.md` — Same bug+fix pattern applied to organizations
- `stigmer-cloud/docs/implementation/apply-authorization-fix.md` — Design doc for the apply authorization pattern

---

**Status**: Production Ready
**Timeline**: ~15 minutes (diagnosis + audit + fix)
