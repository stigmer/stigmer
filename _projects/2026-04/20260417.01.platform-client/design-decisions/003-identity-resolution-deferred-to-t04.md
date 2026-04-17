# Design Decision 003: Identity Resolution Deferred to T04

**Date**: 2026-04-17
**Task**: T03 (Token Endpoint)
**Status**: Superseded by [DD-004](004-mint-time-jit-and-composite-idp-id.md)

## Context

The `mintUserToken` handler receives `(platform_client_id, user_id)` and needs to produce a JWT with a `sub` claim. The original plan assumed `sub` = Stigmer IdentityAccount ID, which requires resolving the external `user_id` to an existing IdentityAccount.

## Discovery

The existing identity model stores external user IDs as `spec.idp_id` scoped by `spec.identity_provider_ref` (org + IdP slug) for federated accounts. PlatformClient has no relationship to IdentityProvider — the mapping between PlatformClient and the identity model hasn't been defined.

Defining this mapping requires answering:
- Should PlatformClient create/reference a synthetic IdentityProvider?
- Should PlatformClient user accounts be a new provisioning mode?
- How is `user_id` uniqueness scoped across multiple PlatformClients?

These questions are inseparable from JIT provisioning (T04), since "how do we find the account" depends on "how did we create the account."

## Decision

**T03 mints JWTs with the external `user_id` as the `sub` claim** — not a Stigmer IdentityAccount ID. The JWT includes `platform_client_id` as a separate claim for scoping.

**T04 handles identity resolution**: When the auth chain (`PlatformClientTokenAuthenticationProvider`) validates a Stigmer-signed JWT, it reads `sub` (external user_id) + `platform_client_id` from claims and resolves or JIT-provisions the IdentityAccount at that point.

## Consequences

- T03 is focused: credential validation + JWT signing. No identity model changes.
- The JWT `sub` claim semantics differ from Auth0/federated JWTs (where `sub` = IdentityAccount ID). T04's auth provider must handle this distinction.
- T04 must define the PlatformClient-to-identity-model relationship before the feature is end-to-end functional.
