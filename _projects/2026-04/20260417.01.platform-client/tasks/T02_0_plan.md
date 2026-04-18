# Task T02: Backend — PlatformClient CRUD + Credential Generation

**Created**: 2026-04-17
**Status**: NOT STARTED
**Estimated effort**: 1–2 sessions
**Repo**: stigmer-cloud
**Depends on**: T01 (proto stubs must be available)

## Objective

Implement PlatformClient create/update/delete handlers in stigmer-cloud, including secure generation of `client_id` + `client_secret` credentials, secret hashing, and persistence.

## Background

Follows the same patterns as ApiKey and OAuthApp handlers in stigmer-cloud. The key difference is that PlatformClient generates an OAuth2 credential pair (client_id + client_secret) rather than a single API key, and the `client_secret` is returned exactly once on creation.

## Task Breakdown

### 1. MongoDB Document + Repository

- `PlatformClient` MongoDB document (follow existing ApiResource document pattern)
- CRUD repository with standard methods: create, update, delete, getById, listByOrg
- Indexes: `client_id` (unique), `org` + `slug` (compound unique)

### 2. Client ID + Secret Generation

- `client_id`: `stgm_cid_` prefix + 32-char random alphanumeric (public, stored as-is)
- `client_secret`: `stgm_cs_` prefix + 48-char random alphanumeric (secret, only hash stored)
- Hashing: SHA-256 of the raw secret (same pattern as ApiKey's `key_hash`)
- Fingerprint: last 6 characters of the raw secret (for UI display)
- The raw `client_secret` is returned in the create response and never stored or retrievable again

### 3. Request Handlers

Follow the handler chain pattern used by other IAM resources:

**Create handler chain:**
- Validate input fields (org exists, required fields present)
- Generate client_id + client_secret
- Hash the secret, store hash + fingerprint
- Create the resource in MongoDB
- Return the response with the raw secret included (one-time)

**Update handler chain:**
- Validate: only mutable fields can change (auto_provision_accounts, auto_grant_on_org, auto_grant_role, allowed_origins)
- client_id and secret_hash are immutable after creation
- Update the resource in MongoDB

**Delete handler chain:**
- Check for dependent resources (if any tokens reference this PlatformClient, decide on cascade behavior)
- Delete the resource
- Invalidate Redis cache entries

**RotateSecret handler:**
- Generate a new client_secret
- Hash and store the new secret
- Invalidate the old secret immediately
- Return the new raw secret (one-time)

### 4. Redis Caching

- Cache `client_id` → PlatformClient mapping for fast token endpoint lookups
- Cache invalidation on update, delete, rotateSecret
- Follow the same caching pattern as `ApiKeyHashToApiKeyCacheProxy`

### 5. gRPC Service Wiring

- Register command and query controllers as gRPC services
- Wire IAM permission annotations from proto
- Add to the service's Spring Boot configuration

### 6. Bazel BUILD Registration

- Add BUILD.bazel targets for the new handlers and tests
- Register test targets in the test suite

## Key Design Decisions

- **Secret returned once**: Follow the ApiKey pattern — the raw secret is only available in the create response. If lost, the user must rotate.
- **client_id is permanent**: Unlike the secret, the client_id never changes. It identifies the PlatformClient across secret rotations.
- **Immutable credentials on update**: The update RPC cannot change client_id or secret_hash. Use rotateSecret for secret changes.

## Success Criteria

- [ ] PlatformClient CRUD operations work via gRPC
- [ ] client_id + client_secret generated correctly with proper prefixes
- [ ] Secret hash stored, raw secret returned only on create/rotate
- [ ] Redis caching for client_id lookups
- [ ] IAM permissions enforced (can_create_platform_client, can_edit, can_delete)
- [ ] Unit tests for all handlers
- [ ] Bazel targets registered and passing

## Files to Create (stigmer-cloud)

```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/platformclient/
  ├── PlatformClientCreateHandler.java
  ├── PlatformClientUpdateHandler.java
  ├── PlatformClientDeleteHandler.java
  ├── PlatformClientRotateSecretHandler.java
  ├── PlatformClientGetByIdHandler.java
  ├── PlatformClientListByOrgHandler.java
  ├── PlatformClientCredentialGenerator.java
  └── PlatformClientDocument.java (or follow existing naming)
```
