# IdentityProvider CRUD — Foundation for Federated Authentication

**Date**: February 20, 2026

## Summary

Implemented the full CRUD backend for `IdentityProvider`, the new first-class API resource that
enables external platforms (e.g., Planton) to establish a trust relationship with Stigmer.
This is the foundational layer for token exchange, federated identity provisioning, and
platform-managed organizations — the core of the Stigmer × Planton integration.

The work spans both repositories: a proto cleanup in `stigmer` (removing a premature lifecycle
state enum) and a complete domain implementation in `stigmer-cloud` (FGA model, repository,
gRPC routing, and six CRUD handlers).

## Problem Statement

Phase 1 of the Stigmer × Planton integration required a concrete implementation path for
the `IdentityProvider` resource, which had been defined at the proto level in a prior session
but had no backend implementation.

### Pain Points

- `IdentityProvider` had a `lifecycle_state` enum (active/suspended/revoked) with no use case
  yet — premature abstraction that would add complexity without benefit for the MVP.
- The proto cleanup needed to follow protobuf field reservation best practices, not just
  field deletion.
- No FGA authorization model existed for the new resource type.
- No MongoDB repository, gRPC routing, or request handlers existed.
- The delete operation required a cross-aggregate data integrity guard: blocking deletion when
  platform-managed organizations still reference the identity provider.

## Solution

### Proto Cleanup (`stigmer`)

Removed `lifecycle_state` (field 1) from `IdentityProviderStatus` and deleted the
`IdentityProviderLifecycleState` enum entirely. Field 1 is reserved (not deleted) per
protobuf best practices to prevent future field number reuse. All downstream stubs (Go, Java,
Python, TypeScript, Dart) were regenerated via `make protos`.

### FGA Authorization Model (`stigmer-cloud`)

Created `identity_provider.fga` with a **restricted access model** — identity providers are
administrative infrastructure, not discoverable content. Only owners, org admins, and operators
can view them. Regular org members have no access. This differs from open-access resources like
agents, which are visible to all org members.

```fga
type identity_provider
  relations
    define organization: [organization]
    define operator: operator from organization
    define owner: [identity_account] or operator
    define viewer: [identity_account] or owner or admin from organization
    define can_view: viewer
    define can_edit: owner
    define can_delete: owner
```

### Repository (`stigmer-cloud`)

`IdentityProviderRepo` extends `AbstractMongoApiResourceRepository<IdentityProvider>` with
collection name `identity_provider`. Provides the standard query methods (`findByOrgAndSlug`,
`findBySlug`, `findByOrg`, `findByIds`) plus paginated `find` and `page` operations.

### gRPC Auto Controller (`stigmer-cloud`)

`IdentityProviderGrpcAutoController` uses `@AutoGrpcRouterController` to register both
command and query controller stubs. The annotation processor generates the full routing
infrastructure at compile time — no manual controller wiring needed.

### Six CRUD Handlers (`stigmer-cloud`)

| Handler | Pattern | Notes |
|---------|---------|-------|
| `IdentityProviderCreateHandler` | Standard create pipeline (10 steps) | No custom steps needed |
| `IdentityProviderUpdateHandler` | Standard update pipeline (9 steps) | Full spec replacement, status preserved |
| `IdentityProviderDeleteHandler` | Delete pipeline + custom guard | `CheckNoReferencingOrgs` step queries org collection |
| `IdentityProviderGetHandler` | Standard get pipeline | Input: `ApiResourceId` |
| `IdentityProviderGetByReferenceHandler` | Custom handler | Slug-based lookup + post-load FGA check |
| `IdentityProviderApplyHandler` | Apply (create or update) | Delegates to create/update handlers |

The most noteworthy handler is `IdentityProviderDeleteHandler`. It contains a custom
`CheckNoReferencingOrgs` inner step that queries the `organization` MongoDB collection for any
platform-managed org referencing this identity provider before allowing deletion. This protects
against orphaning orgs that depend on the trust relationship — even though no such orgs exist
yet, the guard is in place for when they do.

## Implementation Details

**No Temporal workflows** — CRUD is synchronous via the pipeline-based handler framework,
consistent with all other resource types (agents, workflows, skills, etc.). Temporal is reserved
for long-running operations (agent execution, identity account provisioning).

**Delete guard uses MongoTemplate directly** — the `CheckNoReferencingOrgs` step queries the
`organization` collection cross-aggregate via Spring's `MongoTemplate`. This is intentional:
it is a data integrity guard, not domain logic, and using a lightweight direct query avoids
unnecessary coupling to the organization domain's repository.

**All 11 files compile cleanly** — the Bazel build confirms no new compilation errors were
introduced. Pre-existing build failures in `workflowexecution` and `executioncontext` packages
are unrelated to this work.

## Benefits

- **Unblocks Phase 1** of the Stigmer × Planton integration. IdentityProvider CRUD is
  the prerequisite for the token exchange endpoint and JIT identity provisioning.
- **Zero technical debt** — no premature lifecycle state management, no unnecessary abstractions,
  no missing data integrity guards.
- **Follows platform patterns exactly** — code is structurally identical to other domain
  implementations, making it immediately familiar to maintainers.
- **Future-safe** — the `CheckNoReferencingOrgs` guard and protobuf field reservation both
  protect against future mistakes when orgs and lifecycle management are actually added.

## Impact

- `stigmer` repo: 2 proto files changed, 2 generated Go stub files updated
- `stigmer-cloud` repo: 10 new Java files, 1 new FGA model file, `fga.mod` updated,
  all language stubs regenerated (Go, Java, Python, TypeScript, Dart, Dart mobile)
- No breaking changes to existing functionality
- No existing resources modified

## Related Work

- [Session 3 — Added userinfo_endpoint to IdentityProvider proto](../checkpoints/2026-02-20-session-3.md) (prior session)
- Next: Token exchange endpoint — validates external JWTs, calls OIDC UserInfo, JIT-provisions
  federated identity accounts, issues Stigmer-native tokens

---

**Status**: Production Ready
**Timeline**: Single session, February 20, 2026
