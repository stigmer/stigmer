# Design Decision 004: Mint-Time JIT Provisioning and Composite idp_id Encoding

**Date**: 2026-04-17
**Task**: T04 (Auth Chain Integration + JIT Provisioning)
**Status**: Accepted
**Supersedes**: DD-003 (Identity Resolution Deferred to T04)

## Context

T03 deferred identity resolution (DD-003): the `mintUserToken` handler produced JWTs with `sub = external_user_id`, expecting T04's auth provider to resolve or provision the IdentityAccount at validation time.

T04 needed to settle two questions:
1. **When** does JIT provisioning happen — at token mint or at token validation?
2. **How** does a platform-client-provisioned user fit into the `IdentityAccount` model?

## Decision 1: Mint-Time JIT

JIT provisioning happens in `MintUserTokenHandler`, before the JWT is signed. The JWT `sub` claim is the Stigmer IdentityAccount ID.

**Rationale:**
- The proto contract (`spec.proto` lines 26–38) explicitly describes JIT as happening "on first encounter" during `mintUserToken`. The proto is the API — implementation must match.
- PlatformClient JWTs are issued by Stigmer itself, unlike federated JWTs which arrive cold. Stigmer has the earliest hook at mint time and should use it.
- `sub = IdentityAccount.id` follows RFC 7519 for Stigmer-issued tokens identifying Stigmer principals. Downstream systems (audit, FGA, telemetry) consume the account ID directly.
- The auth provider stays trivial: verify RSA signature + extract `sub`. No provisioning on the hot path.
- Error boundary is correct: unknown-user errors surface at the platform backend's `mintUserToken` call, not when the browser makes its first API call.

## Decision 2: Composite idp_id Encoding

Platform-client users are stored as `IdentityAccount` records with:
- `provisioning_mode = platform_client` (new enum value 4)
- `idp_id = "stgm_pc|{platform_client_id}|{external_user_id}"`

No new fields, no scope fields, no mapping tables, no separate collections.

**Rationale:**
- The composite `idp_id` is globally unique by construction: `platform_client_id` is globally unique (`stgm_cid_` + 32 random chars), `external_user_id` is unique within that PlatformClient.
- Follows the existing encoding convention: `auth0|...` (direct), `google-oauth2|...` (federated), `clientId@clients` (machine).
- The existing sparse unique index on `spec.idpId` enforces uniqueness. No new migration needed.
- `IdentityAccount` is self-describing about its provenance via `provisioning_mode`.
- PlatformClient is an admission credential, not an ongoing authentication authority. A live `ApiResourceReference` to PlatformClient would overstate the relationship and create dangling-ref problems on deletion. The `platform_client_id` baked into `idp_id` is an immutable historical marker — not a pointer.

## Why Not Validation-Time JIT (DD-003's Approach)?

- Copies federation's pattern for the wrong reason. Federation resolves at validation because it has no earlier hook. Stigmer controls the mint endpoint — it *has* an earlier hook.
- Puts provisioning on every uncached validation request — a recurring cost vs. one-time at mint.
- Surfaces unknown-user errors at the wrong layer (browser API call vs. platform backend call).

## Why Not a Separate Mapping Table?

- Fragments the uniqueness invariant across two collections.
- Requires a new collection, repo, cache proxy, and resolver — for a data shape structurally identical to what `IdentityAccount` already supports.
- The account can't self-describe its origin without a join.

## Why Not a Live `platform_client_ref` on IdentityAccount?

- PlatformClient is an admission credential, not an identity provider. It does not participate in ongoing authentication.
- A live reference implies a relationship that doesn't exist and creates lifecycle coupling (deletion cascades, etc.).
- The `platform_client_id` embedded in the composite `idp_id` captures provenance without implying liveness.

## Consequences

- `MintUserTokenHandler` now depends on the identity account aggregate (via `PlatformClientAccountProvisioner`). This coupling is appropriate — provisioning *is* the handler's job under the proto contract.
- The JWT `sub` claim semantics are now consistent: Stigmer-issued JWTs always carry `IdentityAccount.id` as `sub`.
- DD-003 is superseded. The deferred question is answered.
- OSS proto change: `platform_client = 4` added to `IdentityAccountProvisioningMode`.
