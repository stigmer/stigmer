# provisionMyAccount RPC — Replace Deleted Auth0 Webhook Pipeline

**Date**: May 3, 2026

## Summary

Added a `provisionMyAccount` RPC that creates an identity account and personal organization for new direct Auth0 signups. This replaces the deleted Auth0 webhook → Cloudflare Worker → Temporal workflow pipeline with a synchronous, user-initiated flow modeled after Planton's proven `provisionMyAccount` pattern (PR #1763). The user's own authenticated request drives provisioning — no race condition, no external triggers, no Auth0 Management API dependency.

## Problem Statement

The Auth0 webhook pipeline cleanup (project 20260503.04) deleted the Temporal workflow that provisioned new operator accounts. Two critical capabilities were lost:

1. **Identity account creation for direct Auth0 signups** — `RequestCallerIdentityMapper` routes direct Auth0 JWTs through `IdpIdToIdentityAccountIdCacheProxy.proxyGet()`, which is lookup-only. New signups had no provisioning path.
2. **Personal organization creation** — `PersonalOrganizationActivitiesImpl` was deleted, leaving `PersonalOrgSlugGenerator` as dead code with no caller.

### Pain Points

- New operator signups would fail with `IdentityAccountNotFoundException` on every API call
- No personal organization means no default workspace for new users
- The `FederatedAutoProvisionerImpl` only handles federated tokens (IdP-based users), not direct Auth0 JWTs
- Existing users (2 provisioned accounts) were unaffected, masking the gap

## Solution

Follow the Planton pattern: an explicit `provisionMyAccount` RPC that the console calls when `whoAmI()` returns `NOT_FOUND`. The RPC derives all identity information from the caller's JWT and the OIDC `/userinfo` endpoint.

Key design decisions:

- **OIDC /userinfo over Admin APIs** — Uses `https://${AUTH0_DOMAIN}/userinfo` with the caller's own access token. No Auth0 Management API, no SDK dependency. IDP-agnostic.
- **Synchronous handler (no Temporal)** — Simpler than Planton's Temporal-based approach. Justified by: (a) Temporal identity_account task queue was just deleted, (b) 2-user dev-stage product, (c) steps are simple and idempotent.
- **Separate from FederatedAutoProvisioner** — Personal org creation lives only in the `provisionMyAccount` path. FederatedAutoProvisioner stays untouched.

## Implementation Details

### Proto (stigmer OSS)

Added `provisionMyAccount` RPC to `IdentityAccountCommandController` in `command.proto`:

- Takes `google.protobuf.Empty` (all info derived from JWT)
- Returns `IdentityAccount`
- `is_skip_authorization = true` (no FGA check — the account doesn't exist yet)

### Handler (stigmer-cloud)

New `ProvisionMyAccountHandler.java` — a `CustomOperationHandlerV2<Empty, IdentityAccount>` with 4 pipeline steps:

| Step | Class | What it does |
|------|-------|-------------|
| 1 | `CheckExistingByIdpId` | Query `IdentityAccountRepo.findByIdpId()`. Return existing account if found (idempotent). Also backfills personal org for existing accounts. |
| 2 | `FetchUserInfoProfile` | Call `UserInfoClient.fetchUserProfile()` at `https://${AUTH0_DOMAIN}/userinfo` with caller's access token. Extract email, name, picture. |
| 3 | `CreateIdentityAccount` | Build IdentityAccount proto with `provisioning_mode = direct`, delegate to `identityAccountGrpcRepo.create()`. Handle `ALREADY_EXISTS` race. |
| 4 | `EnsurePersonalOrganization` | Query `OrganizationRepo.findPersonalOrgByOwner()`. If none, create via `OrganizationGrpcRepo.createOnBehalfOf()` with `is_personal = true`, slug from `PersonalOrgSlugGenerator`. Retry on slug conflict. |

### OrganizationRepo

Added `findPersonalOrgByOwner(identityAccountId)` — queries MongoDB for `spec.isPersonal = true AND status.audit.specAudit.createdBy.id = identityAccountId`. Matches the pattern from the deleted `PersonalOrganizationActivitiesImpl`.

### Why it works without auth pipeline changes

`IdpIdToIdentityAccountIdCacheProxy.proxyGet()` does NOT throw for non-machine accounts when no identity account exists — it returns the raw IDP ID as a fallback. The auth pipeline succeeds with `identityAccountId = rawIdpId`. The handler has `is_skip_authorization = true`, so no FGA checks are attempted.

### Code reuse

Heavy reuse of existing infrastructure — no new dependencies:

- `UserInfoClient` — already exists (used by `FederatedAutoProvisionerImpl`)
- `PersonalOrgSlugGenerator` — already exists (was unused after cleanup)
- `OrganizationGrpcRepo.createOnBehalfOf()` — already exists
- `IdentityAccountGrpcRepo` — already exists

## Benefits

- **Zero race conditions** — User's own request drives provisioning. Account guaranteed to exist before console renders.
- **No external dependencies** — No Auth0 webhooks, no Cloudflare Worker, no Management API credentials.
- **IDP-agnostic** — Uses standard OIDC `/userinfo`, works with any OIDC-compliant provider.
- **Idempotent** — Safe for retry, concurrent calls, and existing account backfill.
- **Personal org backfill** — Existing accounts without personal orgs get one on next `provisionMyAccount` call.

## Impact

### Backend (stigmer-cloud)
| Component | Change | Files |
|-----------|--------|-------|
| ProvisionMyAccountHandler | New handler | 1 new file |
| OrganizationRepo | New query | 1 modified file |
| Proto stubs | Regenerated | 11 modified files |

### APIs (stigmer OSS)
| Component | Change | Files |
|-----------|--------|-------|
| command.proto | New RPC | 1 modified file |
| Proto stubs | Regenerated | 10 modified files |
| SDK codegen | Updated clients | 8 modified files |

### Build Verification
| Target | Result |
|--------|--------|
| stigmer-cloud `make build-java` (89 targets) | Pass |
| stigmer OSS `make build` (CLI + server + workflow-runner) | Pass |
| stigmer OSS `make -C apis lint` | Pass |

## Related Work

- **Planton PR #1763** — The reference implementation that this follows. Planton's approach used Temporal for visibility; Stigmer simplified to synchronous handler.
- **Project 20260503.04** — Auth0 webhook pipeline cleanup that deleted the old provisioning path. This RPC fills the gap.
- **FederatedAutoProvisionerImpl** — Handles federated (IdP-based) user provisioning. Untouched by this change. Complementary, not overlapping.

---

**Status**: Production Ready
**Timeline**: Single session (May 3, 2026)
