# Task T01: Org Invitation Flow — Analysis and Implementation Plan

**Created**: 2026-04-06
**Status**: PENDING REVIEW
**Type**: Feature Development

⚠️ **This plan requires your review before execution**

## Problem Statement

Today, org membership is managed by creating IAM policies with raw principal IDs — unusable for real humans. There is no way to share a link and say "click this to join my org." Additionally, the organization FGA model has no read-only role: the least-privileged org role (`member`) can create environments and trigger agent executions, which cost money. Public invite links with `member` as the minimum role create unacceptable cost exposure.

## Objective

1. Add `viewer` role to the organization FGA model — a safe, zero-cost-exposure role for public invite links.
2. Create `Invitation` as a new `ApiResourceKind` supporting both multi-use (org invite link) and single-use (targeted) patterns.
3. Build SDK-first: hooks and headless components in `@stigmer/react`, consumed by Console.

## Current State (Ground Truth from FGA Models)

### Organization FGA (`organization.fga`)

```
owner > admin > member (no viewer)
member derives: can_view, can_create_environment, can_create_execution_in, can_view_access
admin derives: can_edit, can_manage_members, can_create_agent, can_create_session, ..., can_grant_access
owner derives: can_delete, can_assign_roles
```

### Org-Scoped Resource Viewer Inheritance

Resources use `member from organization` to grant visibility:

| Pattern | Resources | Viewer Relation |
|---------|-----------|----------------|
| **Shared** (org members see all) | agent, skill, workflow, mcp_server, project | `viewer: ... or member from organization` |
| **Personal** (owner-only) | session, agent_instance, environment, workflow_instance, workflow_execution | `viewer: [identity_account] or owner` |
| **Restricted** (admin-only) | iam_policy, identity_provider | `viewer: ... or admin from organization` |

**Key insight**: Adding `viewer` to organization alone is insufficient. Shared resources use `member from organization` — a person who is only `viewer` on the org would not match this relation. We must update shared resources to use `viewer from organization` (which includes members, admins, and owners via the role hierarchy).

---

## Track 0: Organization Viewer Role (Prerequisite)

### Phase 0A: FGA Model Changes

**`organization.fga`** — Add `viewer` as the lowest role in the hierarchy:

```fga
# Add below member
define viewer: [identity_account] or member

# Change from `can_view: member` to:
define can_view: viewer

# Change from `can_view_access: member` to:
define can_view_access: viewer
```

New permission hierarchy: `owner > admin > member > viewer`

| Permission | Before | After |
|-----------|--------|-------|
| `can_view` | `member` | `viewer` |
| `can_view_access` | `member` | `viewer` |
| `can_create_environment` | `member` | `member` (unchanged — viewers cannot create) |
| `can_create_execution_in` | `member` | `member` (unchanged — viewers cannot execute) |
| All other permissions | unchanged | unchanged |

**Shared org-scoped resources** — Update 5 FGA files:

| File | Change |
|------|--------|
| `agentic/agent.fga` | `member from organization` → `viewer from organization` on `viewer` relation |
| `agentic/skill.fga` | `member from organization` → `viewer from organization` on `viewer` relation |
| `agentic/workflow.fga` | `member from organization` → `viewer from organization` on `viewer` relation |
| `agentic/mcp_server.fga` | `member from organization` → `viewer from organization` on `viewer` relation |
| `tenancy/project.fga` | `member from organization` → `viewer from organization` on `viewer` relation |

**No change** to personal resources (session, agent_instance, environment, workflow_instance, workflow_execution) — they don't inherit org membership anyway.

**No change** to restricted resources (iam_policy, identity_provider) — they use `admin from organization` which is unaffected.

### Phase 0B: Proto Changes

In `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`:
- Add `viewer` to `organization`'s `kind_meta.authorization.grantable_roles` (currently: `[owner, admin, member]` → `[owner, admin, member, viewer]`)

### Phase 0C: Backend — Rebuild Stubs and Verify

- Run `make protos` in both repos
- Rebuild Java backend — no Java code changes expected (FGA files are loaded at runtime, not compiled)
- Run existing tests to verify no regressions

### Phase 0D: SDK Updates

- `sdk/typescript/src/iam-role.ts` already has display names for `viewer` (it's IamRole value 4)
- Codegen `authorization-config.ts` regeneration will pick up the new grantable_roles automatically
- React `RoleSelector` will auto-populate with `viewer` from proto metadata

---

## Track 1: Invitation Resource — Proto Layer (stigmer repo)

### Phase 1A: New ApiResourceKind

In `api_resource_kind.proto`:
- Add `invitation = 20` (next available enum value) with `kind_meta`:
  - `group: iam`
  - `api_version: "iam.stigmer.ai/v1"`
  - `kind_name: "Invitation"`
  - `display_name: "Invitation"`
  - `id_prefix: "inv"`
  - `authorization.scope: ORGANIZATION`
  - `authorization.owner: CREATOR_AND_ORG_ADMIN`
  - `grantable_roles: []` (no user-grantable roles on invitations themselves)

### Phase 1B: Proto Messages

New package: `apis/ai/stigmer/iam/invitation/v1/`

**`spec.proto`** — What the user provides when creating an invitation:

```protobuf
message InvitationSpec {
  // The role granted to the identity account upon redemption.
  ai.stigmer.iam.v1.IamRole role = 1;
  
  // Maximum number of times this invitation can be redeemed.
  // 0 means unlimited (use for persistent org invite links).
  // 1 means single-use (use for targeted invitations).
  int32 max_redemptions = 2;
  
  // When this invitation expires. Required.
  // Backend enforces a maximum expiration window (e.g., 30 days).
  google.protobuf.Timestamp expires_at = 3;
  
  // Human-readable label for organizational purposes.
  // e.g., "Engineering team link", "Contractor access"
  string label = 4;
}
```

**`api.proto`** — Full resource envelope:

```protobuf
message Invitation {
  string api_version = 1;  // "iam.stigmer.ai/v1"
  string kind = 2;         // "Invitation"
  ApiResourceMetadata metadata = 3;
  InvitationSpec spec = 4;
  InvitationStatus status = 5;
}

message InvitationStatus {
  // Server-generated cryptographically random token.
  // Included in the invite URL: /invite/<token>
  string token = 1;
  
  // Current state of the invitation.
  InvitationState state = 2;  // active, expired, revoked, fully_redeemed
  
  // Number of times this invitation has been redeemed.
  int32 redemption_count = 3;
  
  // Audit trail of redemptions.
  repeated InvitationRedemption redemptions = 4;
  
  // Standard audit information.
  ApiResourceAudit audit = 99;
}

message InvitationRedemption {
  string identity_account_id = 1;
  google.protobuf.Timestamp redeemed_at = 2;
}
```

**`enum.proto`**:

```protobuf
enum InvitationState {
  invitation_state_unspecified = 0;
  active = 1;
  expired = 2;
  revoked = 3;
  fully_redeemed = 4;
}
```

**`command.proto`** — RPCs:

| RPC | Input | Output | Auth | Notes |
|-----|-------|--------|------|-------|
| `create` | `Invitation` | `Invitation` | `can_grant_access` on org | Validates role is grantable on org; generates token |
| `revoke` | `InvitationId` | `Invitation` | `can_grant_access` on org | Sets state to `revoked` |
| `redeem` | `RedeemInvitationInput` | `Invitation` | Authenticated (any user) | Token-based — no FGA check on invitation resource |

**`query.proto`** — RPCs:

| RPC | Input | Output | Auth | Notes |
|-----|-------|--------|------|-------|
| `get` | `InvitationId` | `Invitation` | `can_view` on invitation | Standard get |
| `listByOrg` | `InvitationOrgInput` | `Invitations` | `can_view_access` on org | Lists org's invitations |
| `getByToken` | `InvitationTokenInput` | `InvitationPreview` | **Public (no auth)** | Returns limited info for redemption page (org name, role, expiry — no token, no redemption history) |

**`io.proto`** — DTOs:

```protobuf
message InvitationId { string value = 1; }
message InvitationOrgInput { string org_id = 1; }
message InvitationTokenInput { string token = 1; }
message Invitations { repeated Invitation entries = 1; }
message RedeemInvitationInput { string token = 1; }

// Safe projection for unauthenticated users viewing an invite link
message InvitationPreview {
  string organization_name = 1;
  string organization_slug = 2;
  string organization_logo_url = 3;
  ai.stigmer.iam.v1.IamRole role = 4;
  google.protobuf.Timestamp expires_at = 5;
  string label = 6;
  bool is_valid = 7;  // false if expired, revoked, or fully redeemed
  string invalid_reason = 8;  // human-readable reason if is_valid is false
}
```

### Phase 1C: Authorization Annotations

- `create` → `(config).permission = can_grant_access` (on the org, checked by handler since the target is the org, not the invitation)
- `revoke` → custom handler auth (load invitation → resolve org → check `can_grant_access` on org)
- `redeem` → skip auth decorator (token is the authorization)
- `getByToken` → skip auth decorator (public endpoint)
- `get` → standard `can_view` on invitation resource
- `listByOrg` → `can_view_access` on org

---

## Track 2: Invitation Backend (stigmer-cloud repo)

### Phase 2A: FGA Model

New file: `fga/model/iam/invitation.fga`

```fga
module iam

type invitation
  relations
    define organization: [organization]
    define owner: [identity_account] or admin from organization
    define viewer: admin from organization
    define can_view: viewer
    define can_edit: owner
    define can_delete: owner
```

Follows the `iam_policy` pattern — admins can view all invitations.

### Phase 2B: Handlers

| Handler | Pipeline Steps | Key Logic |
|---------|---------------|-----------|
| `InvitationCreateHandler` | authenticate → authorize (can_grant_access on org) → validateSpec → generateToken → persist → bootstrapPolicy | Validates: role is grantable on org, expiry within bounds, generates 32-byte crypto-random token (base62-encoded for URL safety) |
| `InvitationRevokeHandler` | authenticate → authorize → load → setState(revoked) → persist | Sets state to `revoked`, idempotent |
| `InvitationGetHandler` | authenticate → authorize (can_view on invitation) → load | Standard get |
| `InvitationListByOrgHandler` | authenticate → authorize (can_view_access on org) → query | Returns all non-expired invitations for the org |
| `InvitationGetByTokenHandler` | load by token → project to InvitationPreview | **No auth** — returns limited info, no sensitive data |
| `InvitationRedeemHandler` | authenticate → loadByToken → validate → createIamPolicy → incrementRedemptionCount → persist | **Atomic**: validate + create IAM policy + update invite in a single handler. If IAM policy creation fails, redemption count is NOT incremented. |

### Phase 2C: Redemption Atomicity

The `redeem` handler orchestrates:
1. Load invitation by token
2. Validate: state is `active`, not expired, not at max redemptions
3. Check: redeemer is not already a member of the org (idempotency guard)
4. Create IAM policy: `iamPolicy.create(principal=currentUser, resource=org, relation=role)` — goes through the full IamPolicyCreateHandler pipeline (including ValidateGrantableRole)
5. **Only if IAM policy creation succeeds**: increment redemption count, add to redemptions list
6. If `max_redemptions > 0` and `redemption_count >= max_redemptions`: set state to `fully_redeemed`

If step 4 fails, steps 5-6 don't execute. No partial state.

### Phase 2D: Token Generation

- 32 bytes of `java.security.SecureRandom`, base62-encoded → ~43 characters
- Tokens are stored in the invitation resource (not hashed — invite tokens are shareable, not secrets)
- Unique index on token field in MongoDB for O(1) lookup
- URL format: `https://<host>/invite/<token>`

### Phase 2E: Repository Layer

`InvitationRepo`:
- `save(Invitation)` — standard
- `findById(id)` — standard
- `findByToken(token)` — indexed query
- `findByOrgId(orgId)` — filtered by org, ordered by created_at desc
- `updateState(id, state, redemptionCount, redemption)` — partial update for redemption

---

## Track 3: SDK Codegen

### Phase 3A: Codegen Schema

New file: `tools/codegen/schemas/services/invitation.json` — follows `apikey.json` pattern:
- Resource: `invitation`
- Package: `ai.stigmer.iam.invitation.v1`
- Services: `InvitationCommandController` (create, revoke, redeem), `InvitationQueryController` (get, listByOrg, getByToken)
- Method types: `InvitationId`, `InvitationOrgInput`, `InvitationTokenInput`, `RedeemInvitationInput`, `Invitations`, `InvitationPreview`
- Enum types: `InvitationState`

### Phase 3B: Generate Clients

- Rebuild `tools/generator`
- Run codegen for all 4 languages (TypeScript, Go, Python, Java)
- Verify generated clients include all RPCs

### Phase 3C: SDK Exports

Update `sdk/typescript/src/index.ts` to export:
- `InvitationClient`
- `InvitationState` enum
- `InvitationPreview` type

---

## Track 4: React SDK (`sdk/react/src/`)

### Phase 4A: Hooks (headless-first)

**`useOrgInvitations(orgId)`**
- Wraps `invitation.listByOrg(orgId)`
- Returns `{ invitations, isLoading, error, refetch }`

**`useCreateInvitation()`**
- Wraps `invitation.create()`
- Returns `{ create, isCreating, error }` — `create` takes `{ orgId, role, maxRedemptions, expiresAt, label }`

**`useRevokeInvitation()`**
- Wraps `invitation.revoke()`
- Returns `{ revoke, isRevoking, error }`

**`useInvitationPreview(token)`**
- Wraps `invitation.getByToken(token)` — fetches on mount
- Returns `{ preview: InvitationPreview, isLoading, error }`

**`useRedeemInvitation()`**
- Wraps `invitation.redeem(token)`
- Returns `{ redeem, isRedeeming, error, isRedeemed }`

### Phase 4B: Components (styled, themeable)

**`InvitationManager`** — Org settings panel for managing invitations:
- Lists active invitations with: label, role badge, redemption count, expiry, copy-link button, revoke button
- "Create Invite Link" form: role selector (defaults to `viewer`), expiration picker, optional label, max redemptions toggle
- Shows the generated URL after creation with a copy button
- Embeddable by platform builders (no Console dependencies)

**`InvitationRedemption`** — The page shown when clicking an invite link:
- Props: `{ token, onSuccess?, onError?, authRedirectUrl? }`
- Shows: org name + logo, role being granted, expiry
- If authenticated: "Accept Invitation" button → calls redeem → `onSuccess` callback
- If not authenticated: shows sign-in prompt with `authRedirectUrl` to return after auth
- Handles: expired, revoked, already-a-member, fully-redeemed states gracefully
- Fully self-contained: no routing, no app shell, no layout assumptions

---

## Track 5: Console Integration

### Phase 5A: Invite Redemption Route

- `/invite/[token]` page in Console (Next.js)
- Renders `<InvitationRedemption token={params.token} />`
- Handles auth redirect flow (if user isn't signed in, redirect to sign-in with return URL)

### Phase 5B: Org Settings Integration

- Add `<InvitationManager />` to the org settings page (alongside existing `<OrgMembersPanel />`)
- Wire to `OrgContext` for active org ID

---

## Implementation Order

```
Track 0 (viewer role)  ──────────────────────────────────────┐
  Phase 0A: FGA model (org + 5 child resources)              │
  Phase 0B: Proto grantable_roles                            │
  Phase 0C: Rebuild stubs, test                              │
  Phase 0D: SDK updates (auto via codegen)                   │
                                                             │
Track 1 (invitation proto) ──── can start in parallel ───────┤
  Phase 1A: ApiResourceKind                                  │
  Phase 1B: Proto messages                                   │
  Phase 1C: Auth annotations + stub generation               │
                                                             │
Track 2 (backend) ──── depends on Track 0 + Track 1 ────────┤
  Phase 2A: FGA model                                        │
  Phase 2B-2E: Handlers, repos, token, redemption            │
                                                             │
Track 3 (SDK codegen) ──── depends on Track 1 ──────────────┤
  Phase 3A-3C: Schema, generate, export                      │
                                                             │
Track 4 (React SDK) ──── depends on Track 3 ────────────────┤
  Phase 4A: Hooks                                            │
  Phase 4B: Components                                       │
                                                             │
Track 5 (Console) ──── depends on Track 4 ──────────────────┘
  Phase 5A: Redemption route
  Phase 5B: Settings integration
```

**Parallelization opportunity**: Track 0 and Track 1 can run in parallel (they're independent proto changes). They converge at Track 2 (backend needs both the viewer role FGA change and the invitation proto).

---

## Open Questions (Flagged for Discussion)

### Q1: Platform-managed orgs

Should invitations be blocked for `management_mode = platform_managed` orgs? If a platform builder is controlling membership through their own system, Stigmer invitations could bypass that control.

**Recommendation**: Block by default for platform-managed orgs. Platform builders can use the SDK API directly if they want to implement their own invite flow.

### Q2: Token in InvitationStatus vs. separate field

I've placed token in `InvitationStatus` (server-generated, read-only). Alternative: a top-level field outside spec/status. Does the current placement feel right?

### Q3: Maximum expiration window

Should the backend enforce a maximum expiration (e.g., 30 days)? Or should we allow indefinite invitations (for persistent org links)?

**Recommendation**: Allow a configurable max at the org level. Default: 30 days. Persistent links set `expires_at` far in the future and rely on `max_redemptions` + revocation for control.

### Q4: Invitation as a searchable resource?

Should invitations appear in the global search (`SearchRequest`)? They're administrative artifacts, not content. I lean toward **no** — they're only accessible through the org settings UI and direct API calls.

### Q5: `getByToken` projection safety

`InvitationPreview` is returned to unauthenticated users. It includes org name, slug, logo, role, and expiry. Is this an acceptable information disclosure? An attacker with a valid token can learn which org it belongs to.

**Recommendation**: This is acceptable — the token is already a shared secret. Knowing the org name is necessary to render the "You've been invited to X" page.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Viewer role breaks existing member behavior | High | `viewer from organization` is a superset of `member from organization` — members still match. Rigorous FGA unit tests. |
| Redemption partial failure | Medium | Atomic handler design — IAM policy creation must succeed before redemption count increments. |
| Token enumeration | Low | 43-character base62 tokens → ~192 bits of entropy. Rate limiting on `getByToken` and `redeem`. |
| Codegen ripple effects from new ApiResourceKind | Medium | Follow existing patterns exactly (api_key as template). Run full codegen pipeline and verify all SDK outputs. |
| FGA model update across 6 files | Medium | Systematic change with clear pattern. Test each resource's FGA independently. |

---

## Success Criteria

1. ✅ Org admin can create invite links with configurable role and expiration
2. ✅ Anyone with a valid link can redeem it to join the org
3. ✅ Viewer role on org grants read-only access (no cost exposure)
4. ✅ Invite links can be revoked, expire, and respect max redemptions
5. ✅ All SDK layers (TS, Go, Python, Java) have generated invitation clients
6. ✅ React hooks and components are headless-first, embeddable without Console dependencies
7. ✅ Console has `/invite/:token` route and `InvitationManager` in org settings

---

## Review Process

**What happens next**:
1. **You review this plan** — focus on the FGA design, proto shape, and open questions
2. **Provide feedback** — especially on Q1-Q5 and anything that feels over- or under-engineered
3. **I'll revise** — create T01_2_revised_plan.md incorporating your feedback
4. **You approve** — explicit go-ahead to start implementation
5. **Execution begins** — Track 0 and Track 1 first (parallel), then Track 2-5 sequentially
