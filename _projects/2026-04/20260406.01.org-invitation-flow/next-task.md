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
**Current Task**: Track 2 — Invitation Backend
**Status**: Ready to Start (Track 0 + Track 1 complete)
**Last Session**: 2026-04-06 (Session 2) — Completed Track 1 (invitation proto layer)

## Session Progress (2026-04-06, Session 2)

- Completed Track 1: Invitation Resource Proto Layer in full
- Created 6 proto files + BUILD.bazel in `apis/ai/stigmer/iam/invitation/v1/`
- Added `invitation = 20` to `ApiResourceKind` enum
- Ran `make codegen` (stigmer) + `make protos` (stigmer-cloud) — all stubs and SDK clients generated
- Wired `InvitationClient` into TypeScript SDK `Stigmer` class and barrel exports
- Discovered: codegen schema JSONs are auto-generated (not hand-maintained)
- Discovered: `is_public` method option exists but is never used; all "public" endpoints use `is_skip_authorization`

## Next Steps

1. **Track 2: Invitation Backend** (stigmer-cloud repo)
   - Phase 2A: Create `invitation.fga` FGA model (organization, owner, viewer relations)
   - Phase 2B: Implement handlers (InvitationCreateHandler, RevokeHandler, RedeemHandler, GetHandler, ListByOrgHandler, GetByTokenHandler)
   - Phase 2C: Redemption atomicity (IAM policy creation + count increment in single handler)
   - Phase 2D: Token generation (32-byte SecureRandom, base62-encoded, unique index)
   - Phase 2E: Repository layer (InvitationRepo: save, findById, findByToken, findByOrgId, updateState)
2. **Track 3: SDK Codegen** (depends on Track 1 — now complete)
3. **Track 4: React SDK** (depends on Track 3)
4. **Track 5: Console Integration** (depends on Track 4)

## Context for Resume

- Track 0 is fully committed in both repos on `feat/identity-provider-flow` branch (commit `524766bc`)
- Track 1 is fully committed in both repos (this session's commit)
- The T01 plan (`tasks/T01_0_plan.md`) has the full implementation details for all 5 tracks
- Key design decision: `can_execute` on child resources must be explicitly enumerated, not derived from `viewer`, to prevent cost exposure
- Key design decision: `is_skip_authorization` used for `getByToken` (public invite preview) following `getSsoProvider` precedent — `is_public` option exists but is untested
- The `iam-role.ts` already has viewer display metadata — no manual SDK changes needed for new roles
- The codegen pipeline auto-generates JSON schemas from protos — never manually create `tools/codegen/schemas/services/*.json`
- The `GeneratedClient` in `sdk/typescript/src/gen/client.ts` is auto-generated and auto-wires new resource clients, but the hand-written `Stigmer` class in `stigmer.ts` and `index.ts` barrel exports need manual updates

## Quick Commands

After loading context:
- "Start Track 2" - Begin invitation backend (FGA + handlers)
- "Show project status" - Get overview of progress
- "Review T01 plan" - See full implementation details for all tracks
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
