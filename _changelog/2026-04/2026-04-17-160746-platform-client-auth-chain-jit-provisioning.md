# PlatformClient Auth Chain Integration + JIT Provisioning (T04)

**Date**: April 17, 2026

## Summary

Implemented mint-time JIT provisioning and auth chain validation for PlatformClient user tokens, completing T04 of the PlatformClient project. Platform builders can now call `mintUserToken` and Stigmer will automatically provision IdentityAccounts on first encounter, using a composite `idp_id` encoding that requires no new collections, indexes, or mapping tables. The auth chain validates Stigmer-signed JWTs and resolves the caller identity in a single cache-backed lookup.

## Problem Statement

T03 shipped the `mintUserToken` endpoint, but the JWT `sub` claim carried the platform's external `user_id` — not a Stigmer IdentityAccount ID. This meant:
- The auth chain couldn't validate Stigmer-signed JWTs
- No identity resolution existed for platform-client users
- JIT provisioning (a key proto contract promise) was unimplemented
- The JWT `sub` semantics diverged from Auth0/federated JWTs where `sub` = IdentityAccount ID

### Pain Points

- Platform builders had no way to get a working end-to-end flow: mint a token and use it on a protected API
- The proto contract (`spec.proto` lines 26-38) described three provisioning modes that didn't work
- The identity model had no concept of a platform-client-provisioned user

## Solution

Two locked decisions drove the implementation:

1. **Mint-time JIT**: Provisioning happens at `mintUserToken`, not at token validation. The JWT `sub` is the IdentityAccount ID by the time it's signed. The auth provider stays trivial — verify RSA signature, extract `sub`, done.

2. **Composite `idp_id` encoding**: `stgm_pc|{platform_client_id}|{external_user_id}` — globally unique by construction. No mapping tables, no scope fields. Follows the existing `auth0|...` / `google-oauth2|...` convention.

## Implementation Details

### OSS Proto Change (`stigmer`)

- Added `platform_client = 4` to `IdentityAccountProvisioningMode` enum
- Extended `idp_id` doc comments to document the `stgm_pc|{pcid}|{extUid}` encoding
- All stubs regenerated (Go, Java, TS, Python, Dart)

### Cloud Implementation (`stigmer-cloud`)

**JWT key refactor** — split `StigmerJwtIssuer` into three focused components:
- `StigmerJwtKeySource` — RSA key pair loading and management
- `StigmerJwtIssuer` — JWT signing (depends on key source)
- `StigmerJwtVerifier` — JWT verification (depends on key source, used by auth provider)

**Identity provisioner** — `PlatformClientAccountProvisioner`:
- `PlatformClientIdentityEncoding` — deterministic composite `idp_id` construction
- `PlatformClientAccountProvisionerImpl` — resolve-or-provision with `ALREADY_EXISTS` recovery (mirrors federated pattern)
- Sealed exception hierarchy for typed error mapping to gRPC status codes

**Mint handler update** — `MintUserTokenHandler`:
- New `ResolveOrProvisionUser` pipeline step between credential validation and JWT minting
- JWT `sub` = IdentityAccount ID; `ext_user_id` claim preserves platform's external user ID

**Auth chain** — `PlatformClientTokenAuthenticationProvider`:
- Chain position: API key → **Stigmer JWT** → federated → Auth0
- Peeks at `iss` claim without verification; returns `null` for non-Stigmer issuers
- On `iss=stigmer`: full RSA verification, throws on failure (no silent passthrough)

**Identity mapper** — `RequestCallerIdentityMapper`:
- Direct branch for `PlatformClientAuthenticationToken` — no cache lookup needed
- Added `platformClientId` to `RequestCallerIdentity` for downstream telemetry

### Design Decisions

- **DD-004**: Mint-time JIT + composite `idp_id` — supersedes DD-003
- **No live reference to PlatformClient** on IdentityAccount — PlatformClient is an admission credential, not an ongoing auth authority. The `platform_client_id` baked into `idp_id` is an immutable historical marker.
- **No new Mongo indexes** — existing sparse unique `spec.idpId` index handles the composite encoding

## Benefits

- **End-to-end flow works**: mint token → use token → API call succeeds → user auto-provisioned
- **Zero new infrastructure**: no new collections, indexes, or mapping tables
- **Hot path is fast**: auth provider does RSA verification + account lookup by ID (Redis cache)
- **Error boundaries are correct**: unknown-user errors surface at `mintUserToken`, not at the browser's first API call
- **Self-describing accounts**: `IdentityAccount.provisioning_mode = platform_client` tells you how every account was created

## Impact

- **Platform builders**: can now complete the full integration — create PlatformClient, call `mintUserToken` from their backend, use the JWT in the React SDK
- **Auth system**: new provider in the chain, minimal impact on existing paths (null passthrough for non-Stigmer JWTs)
- **Identity model**: additive only — new enum value, no schema changes
- **Future work**: T05 (SDK support) and T06 (Console UI) can proceed; the backend is complete

## Related Work

- T01: PlatformClient proto definition
- T02: PlatformClient CRUD + credential generation
- T03: Token endpoint + Stigmer-signed JWT issuance
- **T04**: This changelog — auth chain + JIT provisioning
- T05 (next): SDK client support for PlatformClient auth
- T06: Console UI + documentation

---

**Status**: Production Ready
**Timeline**: 1 session (planned 1-2)
