# PlatformClient Backend CRUD + Credential Generation

**Date**: April 17, 2026

## Summary

Implemented the complete PlatformClient CRUD backend in stigmer-cloud — 7 gRPC handlers, a MongoDB repository with Mongock indexes, credential generation utilities, and FGA authorization wiring. This is the second of six tasks in the PlatformClient project, which enables platform builders to embed Stigmer into their products using OAuth2-style client credentials and server-minted JWTs.

## Problem Statement

PlatformClient was defined at the proto level (T01) but had no backend implementation. Platform builders need the ability to create, manage, and rotate credential pairs (client_id + client_secret) via the Stigmer API before the token-minting endpoint (T03) can function.

### Pain Points

- No way to create or manage PlatformClient resources via the API
- No credential generation infrastructure for the `stgm_cid_` / `stgm_cs_` format
- No MongoDB persistence or indexes for the new resource type
- No FGA authorization tuples for access control

## Solution

Built the full backend stack following existing IAM resource patterns (ApiKey, OAuthApp) while introducing new patterns for the `PlatformClientCreateResponse` wrapper type and the `rotateSecret` operation.

## Implementation Details

### Proto Fix (stigmer repo)

Removed the `apply` RPC from `PlatformClientCommandController`. The apply (create-or-update) pattern is incompatible with credential generation — `create` returns `PlatformClientCreateResponse` (resource + one-time secret) while `apply` returns `PlatformClient`. Silently creating credentials via apply would generate a secret the caller could never retrieve.

Also fixed the SDK codegen resource type inference (`inferResourceType` function in both `proto2schema/main.go` and `generator/sdk_client.go`). The previous logic took the first command method's output type as the resource type, which broke when `apply` was removed — making `create` (which returns a wrapper) the first method. The fix prefers `update`/`delete` output types, which always return the resource directly.

### Credential Generation (stigmer-cloud, api-authentication lib)

- `PlatformClientConstants` — prefix constants (`stgm_cid_`, `stgm_cs_`)
- `PlatformClientCredentialGenerator` — generates client_id (32-byte entropy, Base64URL) and client_secret (48-byte entropy, Base64URL) using `SecureRandom`

Reuses existing `ApiKeyHasher` (SHA-256) and `ApiKeyFingerprintExtractor` (last 6 chars) for hashing and fingerprinting — the algorithms are identical.

### MongoDB Repository + Indexes

- `PlatformClientRepo` extends `AbstractMongoApiResourceRepository<PlatformClient>`, collection `platform_client`
- Custom query: `findByClientId(String)` for auth lookups and uniqueness checks
- Mongock migration with 3 indexes: `metadata.id` (unique), `metadata.org + metadata.slug` (compound unique), `spec.clientId` (unique)

### Command Handlers

**PlatformClientCreateHandler** — The most architecturally significant handler. Uses `CustomOperationHandlerV2<PlatformClient, PlatformClientCreateResponse>` because the response type differs from the input type. Standard `CreateOperationHandlerV2<T>` (which is `OperationHandlerV2<T, T>`) cannot accommodate this. Pipeline stores intermediate `PlatformClient` state in the context data map via `Context.Key<PlatformClient>` since the context's `target` field is typed as the output type.

**PlatformClientUpdateHandler** — Standard `UpdateOperationHandlerV2<PlatformClient>` with two custom steps: `ValidateBusinessRules` (rejects `auto_grant_role = owner`) and `PreserveCredentials` (restores computed spec fields cleared by the framework's `clearComputedFields` step during update).

**PlatformClientDeleteHandler** — Standard `DeleteOperationHandlerV2` pattern.

**PlatformClientRotateSecretHandler** — New pattern with no existing precedent. Uses `CustomOperationHandlerV2<PlatformClientId, PlatformClientCreateResponse>`. Generates a new client_secret while preserving the existing client_id, persists, and returns the one-time secret in the same `PlatformClientCreateResponse` wrapper.

### Query Handlers

Standard patterns: `PlatformClientGetHandler` (by ID), `PlatformClientGetByReferenceHandler` (by org/slug with post-load auth), `PlatformClientListByOrgHandler` (all by org).

## Benefits

- Platform builders can now create and manage PlatformClient resources via gRPC
- Credential lifecycle is fully supported: create, rotate, delete
- MongoDB indexes ensure O(1) lookups by client_id (critical for T03 token endpoint performance)
- FGA authorization provides role-based access control on PlatformClient resources
- Established reusable patterns for `CustomOperationHandlerV2` with different I/O types

## Impact

- **stigmer repo**: 22 files changed (proto fix, codegen fix, regenerated stubs)
- **stigmer-cloud repo**: 12 new files + 16 modified (stubs), Bazel builds pass
- **Unblocks T03**: Token endpoint can now resolve PlatformClient resources and validate credentials
- **New pattern**: `CustomOperationHandlerV2` with context data map for intermediate state — applicable to any future resource where create returns a wrapper type

## Related Work

- T01: PlatformClient proto definition (completed in previous session)
- T03: Token endpoint + Stigmer-signed JWT issuance (next task)
- Design Decision 002: apply RPC removed from PlatformClient
- Wrong Assumption 001: Computed spec fields not preserved during update (framework issue)

---

**Status**: Production Ready
**Timeline**: 1 session
