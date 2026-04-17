# PlatformClient Proto Definition — IAM Resource for Embedded Authentication

**Date**: April 17, 2026

## Summary

Defined the complete PlatformClient API resource at `ai.stigmer.iam.platformclient.v1` — a new IAM resource that enables platform builders to embed Stigmer into their products using OAuth2 client credentials. This is the proto foundation for the full PlatformClient feature, including CRUD operations, secret rotation, and a token-minting gRPC service where Stigmer acts as the authorization server.

## Problem Statement

Platform builders who want to embed Stigmer React components (session viewers, agent UIs, etc.) into their products currently need to set up OIDC federation via IdentityProvider. This requires JWKS endpoints, issuer configuration, and audience setup — a significant barrier for quick integration.

### Pain Points

- IdentityProvider setup requires OIDC infrastructure the platform builder may not have
- No simple credential-based auth path for backend-to-Stigmer token minting
- Platform builders want "create credentials, call one endpoint, get a token" simplicity
- Industry competitors (Twilio, Stream, Liveblocks, Knock) all offer this pattern

## Solution

Introduced PlatformClient as a new IAM resource where Stigmer is the authorization server. Platform builders create a PlatformClient to get `client_id` + `client_secret`, then call `mintUserToken` from their backend to get Stigmer-signed JWTs for their users' browsers.

## Implementation Details

### Proto Files Created (6)

All at `apis/ai/stigmer/iam/platformclient/v1/`:

- **spec.proto**: `PlatformClientSpec` with credential fields (`client_id`, `client_secret_hash`, `secret_fingerprint`), expiration settings, JIT provisioning fields (`auto_provision_accounts`, `auto_grant_on_org`, `auto_grant_role`), and `allowed_origins` for CORS
- **api.proto**: `PlatformClient` resource envelope with custom `PlatformClientStatus` including `last_used_at` for security auditing
- **io.proto**: `PlatformClientCreateResponse` wrapping the resource + one-time raw secret, plus standard ID/collection/list-input messages
- **command.proto**: `PlatformClientCommandController` with `apply`, `create`, `update`, `delete`, `rotateSecret` RPCs and IAM authorization annotations
- **query.proto**: `PlatformClientQueryController` with `get`, `getByReference`, `listByOrg` RPCs
- **token.proto**: `PlatformClientTokenController` with `mintUserToken` RPC — a distinct gRPC service for token minting, separate from CRUD

### Enum Registrations

- `platform_client = 23` in `ApiResourceKind` (group: iam, cloud_only, id_prefix: "pcl", org-scoped authorization)
- `can_create_platform_client = 24` in `IamPermission`

### Codegen Fix

The SDK codegen's `inferServiceRole` function defaulted non-command/query services to `"query"`, causing a field name collision when PlatformClient's three services (command, query, token) were processed. Extended to recognize `"token"` as a distinct service role. All four SDK generators (Go, TypeScript, Python, Java) now correctly handle resources with more than two gRPC services.

### Stubs Generated

All stubs generated and compiling across Go, Java, TypeScript, Python, and Dart. SDK client wrappers auto-generated for all languages with proper `command`/`query`/`token` service separation.

## Benefits

- Platform builders can embed Stigmer with just a credential pair — no OIDC setup
- Token minting is gRPC via Connect — accessible as both gRPC and HTTP/JSON
- JIT provisioning reuses existing IdentityProvider patterns — no new provisioning machinery
- Proto-first approach ensures type safety across all SDKs from day one
- Codegen fix is forward-compatible for any future resource with 3+ services

## Impact

- **Proto/API surface**: New IAM resource type registered, new permission added
- **SDK**: All SDKs now have PlatformClient client classes with create/update/delete/rotate/mint operations
- **Codegen**: `inferServiceRole` now supports `token` role — affects all future resources with non-standard service names
- **Architecture**: Stigmer becomes a token issuer (signing its own JWTs) — backend signing key infrastructure needed in T03

## Related Work

- T02: Backend CRUD + credential generation (stigmer-cloud) — next task
- T03: Token endpoint + Stigmer-signed JWT issuance (stigmer-cloud)
- T04: Auth chain integration + JIT provisioning (stigmer-cloud)
- T05: SDK Node/Go/Python client support for PlatformClient auth
- T06: Console UI + Documentation
- Future: Account linking across auth paths (deferred, not a blocker)

---

**Status**: Production Ready (proto definitions and stubs)
**Timeline**: 1 session
