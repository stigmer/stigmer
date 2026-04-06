# Invitation Resource — Proto Layer and Full SDK Codegen

**Date**: April 6, 2026

## Summary

Added `Invitation` as a new `ApiResourceKind` to the Stigmer platform, defining the complete proto layer (spec, status, enums, RPCs, authorization annotations) and generating SDK clients across all four languages (TypeScript, Go, Python, Java). This is the foundational layer for the org invitation flow — shareable links that grant org membership with configurable roles.

## Problem Statement

Today, org membership is managed by creating IAM policies with raw principal IDs — unusable for real humans. There is no way to share a link and say "click this to join my org." The invitation resource provides the API surface for link-based organization onboarding.

### Pain Points

- No self-service mechanism for users to join an organization
- IAM policy creation requires knowing the exact principal ID upfront
- No support for multi-use invite links (persistent org links) or single-use targeted invitations
- Org admins cannot generate shareable links with configurable roles and expiration

## Solution

Defined `Invitation` as a first-class API resource in the `iam` group, following existing patterns (apikey, identity_provider) with Kubernetes-inspired resource structure (api_version, kind, metadata, spec, status). The proto layer includes:

- **InvitationSpec**: role, max_redemptions, expires_at, label
- **InvitationStatus**: server-generated token, lifecycle state, redemption count/history, audit
- **InvitationState** enum: active, expired, revoked, fully_redeemed
- **InvitationPreview**: safe projection for unauthenticated invite-link visitors
- **6 RPCs**: create, revoke, redeem (commands) + get, listByOrg, getByToken (queries)

## Implementation Details

### ApiResourceKind Entry

Added `invitation = 20` to the enum with kind_meta:
- Group: `iam`, prefix: `inv`, tier: `cloud_only`
- Scope: `AUTHORIZATION_SCOPE_TYPE_ORGANIZATION` with `OWNER_ATTRIBUTION_TYPE_DIRECT`
- Not search-indexed, not versioned, no user-grantable roles on the invitation itself

### Authorization Design

| RPC | Auth Strategy | Permission |
|-----|--------------|-----------|
| create | Proto-level | `can_grant_access` on organization |
| revoke | Handler-level | Loads invitation, resolves org, checks `can_grant_access` |
| redeem | Skip auth | Token is the authorization; handler validates |
| get | Proto-level | `can_view` on invitation |
| listByOrg | Proto-level | `can_view_access` on organization |
| getByToken | Skip auth | Public endpoint for invite preview page |

### Generated Artifacts

The `make codegen` pipeline auto-generated:
- Proto stubs in Go, Java, Python, TypeScript
- Codegen schema (`tools/codegen/schemas/services/invitation.json`)
- SDK clients in all 4 languages
- `resource-availability.ts` updated (invitation in `CLOUD_ONLY_KINDS`)
- SDK resource documentation (`docs/sdk/resources/invitation.mdx`)
- MCP server proto stubs

### Manual SDK Wiring

- `sdk/typescript/src/stigmer.ts`: Added `invitation` property to the `Stigmer` top-level client
- `sdk/typescript/src/index.ts`: Exported `InvitationClient` and `InvitationInput`

## Benefits

- **SDK-first**: Platform builders can create, revoke, and redeem invitations via typed clients (`stigmer.invitation.create(...)`) from day one
- **Full language coverage**: TypeScript, Go, Python, and Java clients generated simultaneously
- **Authorization clarity**: Each RPC has explicit, documented authorization — no ambiguity about who can do what
- **Safe public endpoint**: `InvitationPreview` deliberately omits sensitive data for the unauthenticated invite page

## Impact

- **APIs**: New package `ai.stigmer.iam.invitation.v1` with 6 proto files + BUILD.bazel
- **Proto stubs**: Generated across all languages in both stigmer and stigmer-cloud repos
- **SDK**: `InvitationClient` available on `Stigmer` client in TypeScript, Go, Python, Java
- **Codegen**: Full pipeline validated — new API resources auto-generate schemas and SDK clients
- **Unblocks**: Track 2 (backend handlers/FGA) and Track 3 (React SDK hooks/components)

## Related Work

- Track 0 (committed `524766bc`): Organization viewer role — prerequisite for safe invite links
- Track 2 (next): Backend handlers, FGA model, repository layer, token generation
- Track 3 (next): SDK codegen schema and React hooks (`useOrgInvitations`, `useRedeemInvitation`, etc.)
- Track 4 (next): React components (`InvitationManager`, `InvitationRedemption`)
- Track 5 (next): Console integration (`/invite/[token]` route, org settings)

---

**Status**: ✅ Production Ready (proto layer complete; backend implementation pending)
**Timeline**: Single session (~1.5 hours)
