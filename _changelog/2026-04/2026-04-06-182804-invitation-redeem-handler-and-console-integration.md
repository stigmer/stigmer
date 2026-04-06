# Invitation Redeem Handler + Console Integration

**Date**: April 6, 2026

## Summary

Completed the final two tracks of the org invitation flow: the `InvitationRedeemHandler` backend handler that grants org membership when a user redeems an invite link, and the Console integration that wires the SDK components into the web application with proper auth gating and sidebar-less layout for the invite page.

## Problem Statement

The invitation system had all the building blocks — proto definitions, backend CRUD handlers, SDK codegen, React hooks, and React components — but was missing the critical backend redemption logic and the Console routes that tie everything together for end users.

### Pain Points

- No backend handler to process invitation redemption (token validation, membership check, IAM policy creation, redemption recording)
- No Console route for the invite URL (`/invite/[token]`) that users receive in their invite links
- No Console settings page for admins to manage invitations
- AppShell sidebar would render on the invite page, breaking the standalone landing page UX
- OrgGate would block first-time users (no existing org) from reaching the invite page

## Solution

Implemented the `InvitationRedeemHandler` with a 6-step request pipeline that validates the token, checks existing membership, creates an IAM policy via cross-domain gRPC, and atomically records the redemption. Added Console integration with targeted modifications to `AppShell` and `OrgGate` to support a public zone pattern for invite routes.

## Implementation Details

### InvitationRedeemHandler (stigmer-cloud — 385 lines)

Six-step pipeline extending `CustomOperationHandlerV2<RedeemInvitationInput, Invitation>`:

| Step | Responsibility |
|---|---|
| ValidateFieldConstraints | Standard proto validation on token field |
| LoadByToken | `InvitationRepo.findByToken()` → `NOT_FOUND` |
| ValidateRedemption | State is `active`, not expired, not at max redemptions |
| CheckExistingMembership | `IamPolicyGrpcRepo.checkAuthorization(can_view)` → `ALREADY_EXISTS` |
| GrantOrgRole | `IamPolicyGrpcRepo.createPolicy()` via system channel |
| RecordRedemption | Atomic MongoDB `$inc`/`$push`, auto-transition to `fully_redeemed` |

Key architectural decisions:
- **`createPolicy()` not `bootstrapPolicy()`** — creates a standard user-facing IAM policy through the full pipeline (validation, duplicate detection, FGA tuple write), not a bootstrap-time shortcut.
- **`ALREADY_EXISTS` guard** — checks `can_view` (lowest permission) before creating a policy. Prevents wasted redemption slots and redundant IAM policies for existing members.
- **Policy-first atomicity** — IAM policy is created before redemption is recorded. If recording fails, the user still has access (the important outcome). Retry hits `ALREADY_EXISTS` without incrementing the count.
- **Atomic MongoDB update** — uses `$inc` and `$push` operators for concurrent-safe redemption recording, avoiding read-modify-write races.

### Console Integration (stigmer — 6 files)

**`/invite/[token]` route** — Standalone invite redemption page. Wraps `<InvitationRedemption>` with Console auth callbacks (`isAuthenticated` from `useAuth()`, `login` for `onAuthRequired`, post-accept redirect to joined org).

**`/settings/invitations` route** — Admin invitation management page. Wraps `<InvitationManager org={activeOrgSlug}>` with `CloudFeatureNotice` fallback for local mode, following the `MembersSection`/`ApiKeysSection` pattern.

**`AppShell` public zone** — Added `isPublicZone` detection for `/invite/` paths. Renders children without the sidebar in a centered full-screen layout, creating the standalone landing page experience.

**`OrgGate` bypass** — Added `ORG_GATE_BYPASS_PREFIXES` array with `/invite/` to let first-time users (no existing org) through to the invite page. Hooks ordering preserved to satisfy React rules of hooks.

**Settings navigation** — Added "Invitations" entry with `Link` icon in the Organization group, positioned between Members and Identity Providers.

## Benefits

- **Complete invitation flow**: Users can now click an invite link, authenticate, accept the invitation, and land in the org — end to end.
- **First-time user support**: New users arriving via invite link bypass the org gate and sidebar, creating a focused onboarding experience.
- **Existing member protection**: The `ALREADY_EXISTS` check prevents wasted redemption slots and provides clear UX ("You're already a member").
- **Admin visibility**: `fully_redeemed` state auto-transition gives admins honest status — no "active" invitations that silently reject.
- **SDK-first architecture maintained**: Console pages are thin wrappers around SDK components. Zero business logic in the Console layer.

## Impact

- **End users**: Can accept organization invitations via shareable links
- **Org admins**: Can manage invitations from Settings, see redemption counts and states
- **Platform builders**: All components are in `@stigmer/react` — the Console routes serve as reference implementations
- **Backend**: Cross-domain IAM policy creation follows established patterns (system channel, full pipeline)

## Related Work

- [Invitation Backend Handlers](2026-04-06-170847-invitation-backend-handlers.md) — Session 4: CRUD handlers, FGA model, repository
- [Invitation React Components](2026-04-06-181319-invitation-react-components.md) — Session 5: InvitationManager, InvitationCreatedAlert, InvitationRedemption

---

**Status**: ✅ Production Ready
**Timeline**: Session 6 of the org invitation flow project
