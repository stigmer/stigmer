# Task T01: Proto — PlatformClient Resource Definition

**Created**: 2026-04-17
**Status**: PENDING REVIEW
**Estimated effort**: 1–2 sessions
**Repo**: stigmer (protos + stub generation)

## Objective

Define the `PlatformClient` API resource at `ai.stigmer.iam.platformclient.v1` — the proto definition for OAuth2 client credentials that platform builders use to mint user tokens.

## Background

PlatformClient is a new IAM resource alongside ApiKey, IdentityProvider, and OAuthApp. It represents an OAuth2 client registration where Stigmer is the authorization server. Platform builders create a PlatformClient to get a `client_id` + `client_secret` pair, then use those credentials from their backend to mint user-scoped tokens for browser use.

### Existing patterns to follow

- **ApiKey** (`apis/ai/stigmer/iam/apikey/v1/`) — same credential lifecycle pattern (secret returned once on create, hash stored, fingerprint for UI display)
- **OAuthApp** (`apis/ai/stigmer/iam/oauthapp/v1/`) — same CRUD structure (create, update, delete, get, list), same `@internal` annotation pattern
- **IdentityProvider** (`apis/ai/stigmer/iam/identityprovider/v1/`) — same JIT provisioning fields (`auto_provision_accounts`, `auto_grant_on_org`, `auto_grant_role`)

## Task Breakdown

### 1. Define `spec.proto`

```
ai/stigmer/iam/platformclient/v1/spec.proto
```

Fields to define in `PlatformClientSpec`:

- `client_id` (string, computed) — OAuth client identifier, prefix `stgm_cid_`, generated on creation, public/safe for logs
- `client_secret_hash` (string, computed) — SHA-256 hash of the client secret, never returned after creation
- `secret_fingerprint` (string, computed) — last 6 chars for UI display (same pattern as ApiKey)
- `auto_provision_accounts` (bool) — auto-create identity accounts for unknown users on token mint. Default: true
- `auto_grant_on_org` (string) — org ID to grant access to when auto-provisioning. Empty = no auto-grant
- `auto_grant_role` (IamRole) — role to assign when auto-granting. Default: viewer
- `expires_at` (google.protobuf.Timestamp) — optional expiration for the client secret
- `never_expires` (bool) — when true, secret never expires
- `allowed_origins` (repeated string) — optional CORS origins (future use)

### 2. Define `api.proto`

```
ai/stigmer/iam/platformclient/v1/api.proto
```

- `PlatformClient` message wrapping `ApiResourceMeta` + `PlatformClientSpec`
- `PlatformClients` collection message
- `PlatformClientId` message
- `ListPlatformClientsByOrgInput` message

### 3. Define `command.proto`

```
ai/stigmer/iam/platformclient/v1/command.proto
```

RPCs:
- `create` — creates PlatformClient, generates client_id + client_secret, returns the secret once
- `update` — updates mutable fields (auto_provision_accounts, auto_grant_on_org, auto_grant_role, allowed_origins)
- `delete` — deletes PlatformClient
- `apply` — create-or-update
- `rotateSecret` — generates a new client_secret, invalidates the old one

Permission annotations: `can_create_platform_client`, `can_edit`, `can_delete` (follow OAuthApp pattern).

### 4. Define `query.proto`

```
ai/stigmer/iam/platformclient/v1/query.proto
```

RPCs:
- `getById` — get by resource ID
- `listByOrg` — list all PlatformClients in an org

### 5. Define `io.proto`

```
ai/stigmer/iam/platformclient/v1/io.proto
```

Wrapper messages for create response (must include the raw `client_secret` string, returned only once).

### 6. Define token endpoint messages

Either in a new proto or as part of PlatformClient:
- `CreateUserTokenRequest` — client_id, client_secret, user_id, user_email, user_name, org_id
- `CreateUserTokenResponse` — access_token, token_type, expires_in, user_id

Note: The actual `/oauth/token` endpoint is REST (OAuth2 spec requires `application/x-www-form-urlencoded`), but proto definitions are useful for internal type safety and SDK generation.

### 7. Register resource kind

- Add `platform_client` to `ApiResourceKind` enum in `ai/stigmer/commons/apiresource/`
- Add docs: `apis/ai/stigmer/iam/platformclient/docs/overview.md`

### 8. Generate stubs

- Run proto compilation to generate stubs in Go, Java, TypeScript, Python
- Verify stubs compile cleanly in all languages

## Dependencies

- Access to `ai.stigmer.commons.apiresource` proto definitions (existing)
- Access to `ai.stigmer.iam` proto definitions for IamRole enum (existing)
- `buf` or `protoc` tooling for stub generation

## Success Criteria

- [ ] All proto files compile without errors
- [ ] Stubs generated in Go, Java, TypeScript, Python
- [ ] `platform_client` added to `ApiResourceKind`
- [ ] Documentation overview created
- [ ] Proto structure follows existing IAM resource conventions (ApiKey, OAuthApp, IdentityProvider)

## Files to Create

```
apis/ai/stigmer/iam/platformclient/v1/spec.proto
apis/ai/stigmer/iam/platformclient/v1/api.proto
apis/ai/stigmer/iam/platformclient/v1/command.proto
apis/ai/stigmer/iam/platformclient/v1/query.proto
apis/ai/stigmer/iam/platformclient/v1/io.proto
apis/ai/stigmer/iam/platformclient/docs/overview.md
```

## Files to Modify

```
apis/ai/stigmer/commons/apiresource/*.proto  (add platform_client to ApiResourceKind)
```
