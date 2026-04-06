# Next Task: 20260406.01.org-invitation-flow

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260406.01.org-invitation-flow

**Description**: Implement a link-based invitation system for Stigmer organizations. Add viewer role to org FGA model, create Invitation as a new ApiResourceKind, build full-stack support from protos through backend, SDK codegen, React hooks/components, and Console integration. Supports both multi-use (public org invite link) and single-use (targeted) invitation patterns.
**Goal**: Enable org admins to create shareable invite links that allow people to join their organization with configurable roles. Viewer role provides a safe default for public links (no cost exposure). The invitation system must be SDK-first: embeddable by platform builders, not coupled to Console.
**Tech Stack**: Protobuf, OpenFGA, Java (backend handlers/FGA), TypeScript/Go/Python/Java (SDK codegen), React (hooks and components)
**Components**: apis/ (protos: new invitation resource, org viewer role), stigmer-cloud/backend/ (FGA model, handlers, repos), tools/codegen/ (SDK codegen for new resource), sdk/typescript/ (invitation client, iam-role updates), sdk/react/ (invitation hooks and components), client-apps/web/ (Console invite routes and settings integration)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260406.01.org-invitation-flow/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-06 15:54
**Current Task**: Track 2 — InvitationRedeemHandler (last handler) + Track 5 — Console Integration
**Status**: Track 0, 1, 3, 4A, 4B complete; Track 2 nearly complete (RedeemHandler pending); Track 5 pending
**Last Session**: 2026-04-06 (Session 5) — Completed Track 4B React SDK components (3 components)

## Session Progress (2026-04-06, Session 5)

- Completed **Track 4B: Invitation React SDK Components** (stigmer repo)
- Created `InvitationCreatedAlert` (186 lines)
  - One-time banner with copyable invite URL, follows `ApiKeyCreatedAlert` pattern
  - Clipboard API copy with fallback text selection, "Copied" feedback
- Created `InvitationManager` (842 lines)
  - Self-contained admin panel following `OrgMembersPanel` pattern
  - Internal flow state machine: idle → creating → created (alert + refresh) → idle
  - Create form: `RoleSelector` (defaults to viewer), label, expiry picker (7/14/30d), usage limit (unlimited/single-use)
  - Invitation list: label, role badge, state badge, redemption count, expiry, copy-link, revoke with inline confirmation
  - `buildInviteUrl` prop for custom URL schemes, defaults to `window.location.origin/invite/<token>`
  - Reuses existing `RoleSelector` from `iam-policy/` module
- Created `InvitationRedemption` (435 lines)
  - Auth-agnostic invite acceptance flow via `isAuthenticated` + `onAuthRequired` props
  - Fetches preview via `useInvitationPreview` (public endpoint)
  - Handles all states: loading, fetch error, invalid (expired/revoked/fully_redeemed), accept, sign-in CTA, redemption-in-flight, success, redemption error
  - Org card: logo/initial avatar, org name, label, role badge, expiry
- Updated barrel exports in `invitation/index.ts` and `sdk/react/src/index.ts`
- Build verified: `npm run typecheck` + `npm run build` — zero errors
- Committed: `e24dade0`
- Design decisions made:
  - **D1: `buildInviteUrl` prop** — function `(token) => string` with browser-default, platform builders override for custom URL schemes
  - **D2: `isAuthenticated` boolean** — defaults to `true`, keeps component auth-agnostic
  - **D3: `org` (slug) not `orgId`** — mirrors proto `ListInvitationsByOrgInput.org` parameter shape

## Session Progress (2026-04-06, Session 4)

- Completed **Track 2: Invitation Backend** (stigmer-cloud repo) — all phases except RedeemHandler
- Phase 2A: Created `invitation.fga` FGA model (org-scoped, admin visibility, owner CRUD)
  - Registered in `fga.mod`, validated with `fga model validate`
- Phase 2D: Created `InvitationTokenGenerator` utility
  - 16 bytes SecureRandom, Base62 encoded (~22-char alphanumeric tokens)
  - No prefix — URL path `/invite/<token>` provides context
- Phase 2E: Created `InvitationRepo` (MongoDB) + `U20260406_InvitationIndexes` (Mongock migration)
  - Custom queries: `findByToken`, `findByOrg` (sorted by creation time desc)
  - Unique indexes on `metadata.id` and `status.token`
- Created `InvitationGrpcAutoController` with `@AutoGrpcRouterController`
- Implemented 5 handlers:
  - `InvitationCreateHandler` — standard create pipeline + custom `ValidateInvitationSpec` (grantable role, expiry bounds, max_redemptions) + `GenerateToken`
  - `InvitationRevokeHandler` — loads by ID, manual auth against org, sets state to revoked (idempotent)
  - `InvitationGetHandler` — standard `GetOperationHandlerV2` with `can_view` FGA check
  - `InvitationListByOrgHandler` — lists by org with `can_view_access` auth
  - `InvitationGetByTokenHandler` — public endpoint, loads org via MongoTemplate cross-domain read, projects to `InvitationPreview`
- Build verified: `make build-java` — zero compilation errors
- FGA model validated: `fga model validate --file fga.mod` — `{"is_valid":true}`
- Design decisions made (token format):
  - **Base62** over Base64URL — universally safe for copy-paste across messaging platforms
  - **16 bytes (128 bits)** over 32 bytes — sufficient for short-lived, revocable tokens, produces cleaner URLs
  - **No prefix** — URL path is the context, keeps tokens short
  - **Plaintext storage** — tokens are shareable, not secrets (unlike API keys)
- Discovered: `StepResult` uses `toString()` or `authConfig.getErrorMsg()` for error messages (not `getErrorMessage()`)

## Next Steps

1. **Track 2: InvitationRedeemHandler** (stigmer-cloud repo) — NEEDS ARCHITECTURAL DISCUSSION
   - Cross-aggregate: invitation domain needs to create IAM policies
   - Options: call `IamPolicyRepo.save()` + `OpenFgaWriter.write()` directly, use shared `IamPolicyCreationService`, or invoke `IamPolicyCreateHandler` programmatically
   - Atomicity: IAM policy must succeed before redemption count increments
   - Idempotency: check if redeemer is already an org member
   - State transitions: `active` -> `fully_redeemed` when max_redemptions reached
2. **Track 5: Console Integration** (depends on Track 4B — COMPLETE)
   - `/invite/[token]` route — renders `<InvitationRedemption token={params.token} />`
   - Org settings integration — new `InvitationsSection` wrapper, renders `<InvitationManager org={orgSlug} />`
   - Add "Invitations" entry to `SETTINGS_NAV_GROUPS` in `settings-nav.ts`

## Context for Resume

- Track 0 is fully committed (commit `524766bc`)
- Track 1 is fully committed (commit `7f92da62`)
- Track 3 was auto-completed by the Track 1 codegen run (no separate commit needed)
- Track 4A is committed (commit `2b3f4045`)
- Track 4B is committed (commit `e24dade0`)
- Track 2 backend: committed in Session 4 (5 handlers + FGA + repo + migration + token utility + controller)
- Track 2 remaining: **InvitationRedeemHandler only** — deferred for focused architectural discussion
- The T01 plan (`tasks/T01_0_plan.md`) has the full implementation details for all 5 tracks
- Key design decision: `can_execute` on child resources must be explicitly enumerated, not derived from `viewer`, to prevent cost exposure
- Key design decision: `is_skip_authorization` used for `getByToken` (public invite preview) following `getSsoProvider` precedent
- Key design decision: Base62 tokens (16 bytes, no prefix) for invite URLs — discussed and agreed in Session 4
- Key design decision: `buildInviteUrl` prop (not hardcoded URL) for invite components — platform builders may have custom routes
- Key design decision: `isAuthenticated` boolean prop (not embedded auth detection) — keeps InvitationRedemption auth-agnostic
- Key design decision: `org` (slug) not `orgId` for InvitationManager — mirrors proto parameter shape
- The codegen pipeline auto-generates JSON schemas from protos — never manually create `tools/codegen/schemas/services/*.json`
- The `GeneratedClient` in `sdk/typescript/src/gen/client.ts` is auto-generated and auto-wires new resource clients, but the hand-written `Stigmer` class in `stigmer.ts` and `index.ts` barrel exports need manual updates
- Invitation React hooks follow the exact patterns from api-key, organization, and iam-policy hooks (useState/useEffect, no React Query)
- Invitation React components follow `OrgMembersPanel` pattern (self-contained panels) rather than API key pattern (separate pieces requiring Console-level composition)
- `InvitationManager` reuses existing `RoleSelector` from `iam-policy/` module (cross-domain import within SDK is fine)
- Cosmetic codegen JSON reordering diffs exist in stigmer working tree (not committed — functionally no-op, from `make codegen` verification)
- Backend handler patterns learned: `CreateOperationHandlerV2` for standard CRUD, `CustomOperationHandlerV2` for non-standard I/O types, `GetOperationHandlerV2` for reads, `@AutoGrpcRouterController` for gRPC wiring

## Quick Commands

After loading context:
- "Start RedeemHandler" - Begin the deferred cross-aggregate handler (discuss approach first)
- "Start Track 5" - Begin Console integration (routes + settings wiring)
- "Show project status" - Get overview of progress
- "Review T01 plan" - See full implementation details for all tracks
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
