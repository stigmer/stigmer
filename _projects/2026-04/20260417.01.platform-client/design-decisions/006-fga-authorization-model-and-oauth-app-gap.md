# DD-006: FGA Authorization Model for PlatformClient (and OAuthApp Gap Fix)

**Date**: 2026-04-17
**Status**: Implemented
**Context**: T02 (backend CRUD) shipped without FGA model changes

## Problem

T02 completed the PlatformClient backend (CRUD handlers, credential generation, repository, Mongock migration) but omitted the OpenFGA authorization model. Every non-`mintUserToken` RPC on `platform_client` was broken end-to-end:

1. **No `platform_client` type in FGA.** The `CreateAuthorizationTuples` step in `PlatformClientCreateHandler` writes tuples like `platform_client:pcl_xxx#organization@organization:acme`, but the schema had no `platform_client` type to receive them.

2. **`organization.fga` missing `can_create_platform_client`.** The create RPC declares `resource_kind = organization; permission = can_create_platform_client` in its proto method options. `RequestAuthorizationService` uses the permission enum name verbatim as the FGA relation, but the organization type never defined it. Result: create is denied for everyone, including org owners.

3. **Pre-existing `can_create_oauth_app` gap.** The same omission existed for OAuthApp since commit `ad6de7b1`. Fixed in the same change since it is the identical bug class.

### Root Cause

Authorization declarations live in two separate artifacts with no enforced consistency:
- Proto RPC method options (`command.proto`, `query.proto`)
- FGA model files (`fga/model/iam/*.fga`, `fga/model/tenancy/organization.fga`)

T02's "bazel build passes" validated compilation, not authorization behavior.

## Decision

### Access Model: Restricted (mirrors OAuthApp)

PlatformClient follows the same Restricted pattern as `oauth_app.fga` and `identity_provider.fga`:

- **Viewer**: owner + org admins + directly granted identity accounts
- **can_edit / can_delete**: owner only
- **Org members**: no access

Rationale: PlatformClients contain credential material (`client_secret_hash`). Admins need governance visibility (who owns which client, fingerprint, rotation history, provisioning config) but the plaintext secret and hash are never returned by the API layer. Regular org members should not see these administrative resources.

Personal model (like `api_key.fga`) was considered but rejected: API keys are personal credentials tied to a single user; PlatformClients are org-level infrastructure resources that admins must be able to audit.

### Org-Level Create Permissions

Both `can_create_platform_client` and `can_create_oauth_app` are gated on `admin`, consistent with `can_create_idp` and `can_create_identity_account` — all administrative IAM artifacts.

### Structural Regression Test

`ProtoFgaSchemaConsistencyTest` walks every proto `FileDescriptor` that defines gRPC services, extracts `(resource_kind, permission)` pairs from `RpcAuthorizationConfig` method options, and asserts each pair has a matching relation in the FGA model. This catches proto-FGA drift at compile time.

## Known Limitations (Not Fixed)

- **Operator access.** Platform-wide operator propagation was removed in commit `43926471`. Neither `platform_client` nor `oauth_app` have operator access in FGA. Reintroducing operator access for credential resources is a separate design conversation.

- **Persist-before-FGA ordering.** `PlatformClientCreateHandler` persists the resource to MongoDB before writing FGA tuples. An FGA outage between the two steps leaves an orphaned resource with no authorization tuples. This is shared behavior across all create handlers and requires a framework-level transactional fix.

## Files Changed

### stigmer-cloud

- `fga/model/iam/platform_client.fga` (new) — Restricted access type
- `fga/model/tenancy/organization.fga` — added `can_create_platform_client` and `can_create_oauth_app`
- `fga/model/fga.mod` — registered `iam/platform_client.fga`
- `ProtoFgaSchemaConsistencyTest.java` (new) — proto-FGA consistency test
- `PlatformClientAuthorizationTest.java` (new) — handler authorization path tests
- `BUILD.bazel` — test targets for both new tests
