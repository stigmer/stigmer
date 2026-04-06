# Invitation Backend: FGA Model, Repository, Token Generator, and Request Handlers

**Date**: April 6, 2026

## Summary

Implemented the backend infrastructure for organization invitations in the Stigmer platform. This includes the OpenFGA authorization model, MongoDB repository with custom queries, a cryptographically secure Base62 token generator, Mongock index migrations, and five gRPC request handlers covering create, revoke, get, list-by-org, and public token preview. The `InvitationRedeemHandler` is deferred for focused architectural discussion.

## Problem Statement

The invitation flow requires a full backend implementation to support the proto definitions (Track 1) and SDK hooks (Track 4A) already in place. Organization admins need to create shareable invite links, manage them (view, revoke), and allow unauthenticated users to preview invitation details before redeeming.

### Pain Points

- No backend existed for the `Invitation` API resource — proto definitions had no handlers to process requests
- Authorization model for invitations needed to be defined (who can create, view, revoke)
- Invite tokens need to be secure, URL-safe, and short enough for clean share-ability across messaging platforms
- Public token preview endpoint must not leak sensitive data while providing enough context for the invitee

## Solution

Built the complete invitation backend following established patterns from identity-provider and api-key domains, using the Request Pipeline V2 framework. Token design was driven by a careful UX analysis — Base62 encoding over Base64URL for universal copy-paste safety, and 16-byte entropy for shorter (~22-char) tokens that are still cryptographically strong for revocable resources.

## Implementation Details

### FGA Authorization Model (`invitation.fga`)

Organization-scoped type with three relationship tiers:
- `owner`: invitation creator + org admins (full CRUD)
- `viewer`: org admins only (read-only visibility)
- Permissions: `can_view` (viewer), `can_edit` (owner), `can_delete` (owner)

### Token Generator (`InvitationTokenGenerator.java`)

Static utility generating 16-byte cryptographically random tokens encoded in Base62:
- `SecureRandom` for entropy, `BigInteger`-based Base62 conversion
- Produces ~22-character alphanumeric strings (no special characters)
- URL-safe, double-click-selectable, messaging-platform-friendly

### Repository & Migration

- `InvitationRepo` extends `AbstractMongoApiResourceRepository<Invitation>` with `findByToken(String)` and `findByOrg(String)` queries
- `U20260406_InvitationIndexes` creates unique indexes on `metadata.id` and `status.token`, plus ascending index on `metadata.org`

### Request Handlers

| Handler | Base Class | Authorization | Key Behavior |
|---------|-----------|---------------|-------------|
| `InvitationCreateHandler` | `CreateOperationHandlerV2` | Standard (FGA) | Validates spec (grantable role, future expiry, max_redemptions), generates token |
| `InvitationRevokeHandler` | `CustomOperationHandlerV2` | Manual (`can_grant_access` on org) | Loads by ID, sets state to `revoked` via `updateFields` |
| `InvitationGetHandler` | `GetOperationHandlerV2` | Standard (`can_view`) | Standard get by ID pipeline |
| `InvitationListByOrgHandler` | `CustomOperationHandlerV2` | Manual (`can_view_access` on org) | Lists all invitations for an org, sorted by creation time desc |
| `InvitationGetByTokenHandler` | `CustomOperationHandlerV2` | Skipped (public) | Cross-domain org projection via MongoTemplate, builds `InvitationPreview` with validity checks |

### Auto-Controller

`InvitationGrpcAutoController` uses `@AutoGrpcRouterController` to auto-generate both command and query gRPC controller implementations from proto stubs.

## Benefits

- **Complete CRUD pipeline** for invitations (minus redemption) — create, view, list, revoke
- **Public preview endpoint** enables invite landing pages without authentication
- **Secure, human-friendly tokens** — short alphanumeric strings that work everywhere
- **Consistent patterns** — every handler follows established pipeline conventions, reducing maintenance burden
- **Authorization hardened** — FGA model scopes all operations, public endpoint carefully projects only safe fields

## Impact

- **Backend**: 10 new files (1 FGA model, 1 token generator, 1 repo, 1 migration, 1 controller, 5 handlers) + 1 modified (`fga.mod`)
- **API surface**: 5 of 6 `Invitation` RPCs are now functional (create, revoke, get, listByOrg, getByToken)
- **Dependencies**: Track 4A React hooks can now connect to a live backend for all operations except redeem
- **Remaining**: `InvitationRedeemHandler` deferred — requires cross-aggregate IAM policy creation design

## Related Work

- Track 0: Organization viewer role FGA model
- Track 1: Invitation proto definitions (`api.proto`, `command.proto`, `query.proto`, `spec.proto`, `io.proto`, `enum.proto`)
- Track 3: SDK codegen (auto-completed by Track 1's `make codegen`)
- Track 4A: React invitation hooks (`useOrgInvitations`, `useCreateInvitation`, `useRevokeInvitation`, `useInvitationPreview`, `useRedeemInvitation`)
- Next: InvitationRedeemHandler, Track 4B React components, Track 5 Console integration

---

**Status**: ✅ Production Ready (5 of 6 RPCs)
**Timeline**: Single session (~2 hours)
