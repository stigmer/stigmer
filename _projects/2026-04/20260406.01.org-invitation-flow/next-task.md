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
**Current Task**: Track 4B — React SDK Components (InvitationManager, InvitationRedemption)
**Status**: Track 0, 1, 3, 4A complete; Track 2 in progress (separate conversation); Track 4B and 5 pending
**Last Session**: 2026-04-06 (Session 3) — Completed Track 3 verification + Track 4A (invitation React hooks)

## Session Progress (2026-04-06, Session 3)

- Verified Track 3 (SDK Codegen) was already complete from Session 2's `make codegen` run
  - `tools/codegen/schemas/services/invitation.json` exists (auto-generated)
  - Generated clients present in TS, Go, Python, Java SDKs
  - `InvitationClient` already wired in `stigmer.ts` and exported from `index.ts`
- Completed Track 4A: Invitation React Hooks (Phase 4A)
  - Created `sdk/react/src/invitation/` with 5 hooks + domain barrel
  - `useOrgInvitations(org)` — data hook wrapping `listByOrg` with nullable org, fetchKey/refetch, cancellation
  - `useCreateInvitation()` — mutation hook wrapping `create` with `InvitationInput`
  - `useRevokeInvitation()` — mutation hook wrapping `revoke(id)`, idempotent
  - `useInvitationPreview(token)` — data hook wrapping public `getByToken` endpoint
  - `useRedeemInvitation()` — mutation hook wrapping `redeem(token)`, internal proto construction
  - Updated `sdk/react/src/index.ts` barrel with invitation section
  - Zero linter errors, TypeScript compilation passes
- Design decisions documented in plan:
  - Parameter simplification: hooks accept primitives, construct protos internally
  - No `isRedeemed` success-state tracking on mutation hooks (caller handles via promise)
  - `org` parameter naming (slug, not ID) matches domain vocabulary
  - No `useInvitationGet(id)` — no current use case, avoids API surface bloat
  - `useInvitationPreview` documents public endpoint semantics in JSDoc

## Next Steps

1. **Track 2: Invitation Backend** (stigmer-cloud repo) — IN PROGRESS (separate conversation)
   - Phase 2A: Create `invitation.fga` FGA model (organization, owner, viewer relations)
   - Phase 2B-2E: Handlers, repos, token generation, redemption atomicity
2. **Track 4B: React SDK Components** (depends on Track 4A — now complete)
   - `InvitationManager` — org settings panel for managing invitations (list, create, copy link, revoke)
   - `InvitationRedemption` — public invite page (show org info, accept/sign-in)
3. **Track 5: Console Integration** (depends on Track 4B)
   - `/invite/[token]` route
   - Org settings integration

## Context for Resume

- Track 0 is fully committed (commit `524766bc`)
- Track 1 is fully committed (commit `7f92da62`)
- Track 3 was auto-completed by the Track 1 codegen run (no separate commit needed)
- Track 4A is committed (this session's commit)
- Track 2 is being worked on in parallel in a separate conversation (stigmer-cloud repo)
- The T01 plan (`tasks/T01_0_plan.md`) has the full implementation details for all 5 tracks
- Key design decision: `can_execute` on child resources must be explicitly enumerated, not derived from `viewer`, to prevent cost exposure
- Key design decision: `is_skip_authorization` used for `getByToken` (public invite preview) following `getSsoProvider` precedent
- The codegen pipeline auto-generates JSON schemas from protos — never manually create `tools/codegen/schemas/services/*.json`
- The `GeneratedClient` in `sdk/typescript/src/gen/client.ts` is auto-generated and auto-wires new resource clients, but the hand-written `Stigmer` class in `stigmer.ts` and `index.ts` barrel exports need manual updates
- Invitation React hooks follow the exact patterns from api-key, organization, and iam-policy hooks (useState/useEffect, no React Query)
- Cosmetic codegen JSON reordering diffs exist in working tree (not committed — functionally no-op, from `make codegen` verification)

## Quick Commands

After loading context:
- "Start Track 4B" - Begin invitation React components
- "Start Track 5" - Begin Console integration (after Track 4B)
- "Show project status" - Get overview of progress
- "Review T01 plan" - See full implementation details for all tracks
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
