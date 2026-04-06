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
**Current Task**: ALL TRACKS CODE-COMPLETE — ready for smoke test and PRs
**Status**: Tracks 0, 1, 2, 3, 4A, 4B, 5 all complete
**Last Session**: 2026-04-06 (Session 6) — Completed InvitationRedeemHandler + Console integration

## Session Progress (2026-04-06, Session 6)

- Completed **Track 2: InvitationRedeemHandler** (stigmer-cloud, 385 lines)
  - 6-step pipeline: ValidateFieldConstraints → LoadByToken → ValidateRedemption → CheckExistingMembership → GrantOrgRole → RecordRedemption
  - Uses `IamPolicyGrpcRepo.createPolicy()` via system channel (not `bootstrapPolicy()`)
  - `ALREADY_EXISTS` guard checks `can_view` before creating policy — prevents wasted redemption slots
  - Policy-first atomicity: IAM policy created before redemption recorded
  - Atomic MongoDB `$inc`/`$push` for concurrent-safe redemption recording
  - Auto-transitions to `fully_redeemed` when max reached
- Completed **Track 5: Console Integration** (stigmer, 6 files)
  - `/invite/[token]` route — standalone page without sidebar, wraps `InvitationRedemption` with Console auth
  - `/settings/invitations` route — admin management page, wraps `InvitationManager` with active org slug
  - `AppShell` — added `isPublicZone` for `/invite/` paths (no sidebar)
  - `OrgGate` — added bypass for `/invite/` paths (first-time users can reach invite page)
  - `settings-nav.ts` — added "Invitations" entry with Link icon
- Build verified: Java build, ESLint, TypeScript check — all pass
- Design decisions made:
  - **`createPolicy()` not `bootstrapPolicy()`** — standard user-facing IAM policy through full pipeline
  - **`ALREADY_EXISTS` for existing members** — `can_view` check (lowest permission) before policy creation
  - **Policy-first atomicity** — user gets access even if recording fails; retry hits ALREADY_EXISTS safely
  - **OrgGate bypass** — targeted pathname check, not a route group refactor

## Session Progress (2026-04-06, Session 5)

- Completed **Track 4B: Invitation React SDK Components** (stigmer repo)
- Created `InvitationCreatedAlert` (186 lines), `InvitationManager` (842 lines), `InvitationRedemption` (435 lines)
- Committed: `e24dade0`

## Session Progress (2026-04-06, Session 4)

- Completed **Track 2: Invitation Backend** (stigmer-cloud repo) — all phases except RedeemHandler
- 5 handlers + FGA model + repo + migration + token generator + controller
- Committed: `926294c9`

## Next Steps

1. **End-to-end manual smoke test** of the invitation flow
2. **Create PR for stigmer-cloud** (InvitationRedeemHandler)
3. **Create PR for stigmer** (Console integration + changelog)
4. **Address pre-existing Go codegen error** (`invitationv1.IamRole` undefined in `sdk/go/internal/gen/invitation.go`) — separate issue

## Context for Resume

- Track 0 committed: `524766bc` (org viewer role)
- Track 1 committed: `7f92da62` (invitation proto + SDK codegen)
- Track 3 auto-completed by Track 1 codegen (no separate commit)
- Track 4A committed: `2b3f4045` (React hooks)
- Track 4B committed: `e24dade0` (React components)
- Track 2 backend handlers committed: `926294c9` (5 handlers + FGA + repo)
- Track 2 RedeemHandler: committed in Session 6 (pending in this session's commit)
- Track 5 Console integration: committed in Session 6 (pending in this session's commit)
- All architectural decisions for RedeemHandler are documented in `checkpoints/2026-04-06-session-6.md`
- Pre-existing codegen JSON reordering diffs still in working tree (not committed — functionally no-op)
- Pre-existing Go codegen error in `sdk/go/internal/gen/invitation.go` — separate issue to track

## Quick Commands

After loading context:
- "Create stigmer-cloud PR" - PR for InvitationRedeemHandler
- "Create stigmer PR" - PR for Console integration
- "Run smoke test" - End-to-end manual verification
- "Show project status" - Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
