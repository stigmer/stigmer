# Project: 20260406.01.org-invitation-flow

## Overview
Implement a link-based invitation system for Stigmer organizations. Add viewer role to org FGA model, create Invitation as a new ApiResourceKind, build full-stack support from protos through backend, SDK codegen, React hooks/components, and Console integration. Supports both multi-use (public org invite link) and single-use (targeted) invitation patterns.

**Created**: 2026-04-06
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable org admins to create shareable invite links that allow people to join their organization with configurable roles. Viewer role provides a safe default for public links (no cost exposure). The invitation system must be SDK-first: embeddable by platform builders, not coupled to Console.

### Timeline
**Target Completion**: Flexible — no hard deadline

### Technology Stack
Protobuf, OpenFGA, Java (backend handlers/FGA), TypeScript/Go/Python/Java (SDK codegen), React (hooks and components)

### Project Type
Feature Development

### Affected Components
apis/ (protos: new invitation resource, org viewer role), stigmer-cloud/backend/ (FGA model, handlers, repos), tools/codegen/ (SDK codegen for new resource), sdk/typescript/ (invitation client, iam-role updates), sdk/react/ (invitation hooks and components), client-apps/web/ (Console invite routes and settings integration)

## Project Context

### Dependencies
Depends on existing IamRole/IamPermission enums (iam/v1/enum.proto), AuthorizationConfig grantable_roles, IamPolicy create/delete pipeline, OrgMembersPanel (sdk/react). No external blockers.

### Success Criteria
- 1. Org admin can create invite links with configurable role and expiration. 2. Anyone with a valid link can redeem it to join the org. 3. Viewer role on org grants read-only access (no cost exposure). 4. Invite links can be revoked
- expire
- and respect max redemptions. 5. All SDK layers (TS
- Go
- Python
- Java) have generated invitation clients. 6. React hooks and components are headless-first
- embeddable without Console dependencies. 7. Console has /invite/:token route and InvitationManager in org settings.

### Known Risks & Mitigations
1. FGA model change for viewer role must be carefully tested against all org-scoped resources (viewer on org should derive viewer on child resources). 2. Invitation redemption must be atomic (validate + create IAM policy + update invite) — partial failure leaves inconsistent state. 3. Token security: tokens must be cryptographically random and unguessable. 4. Platform-managed orgs may need different invitation behavior. 5. Adding a new ApiResourceKind has wide codegen ripple effects.

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [x] Initial analysis complete (T01 plan reviewed and approved)
- [x] Track 0: Organization viewer role (FGA + proto + SDK codegen)
- [ ] Track 1: Invitation resource proto layer
- [ ] Track 2: Invitation backend (handlers, repo, token, redemption)
- [ ] Track 3: SDK codegen (invitation clients for all languages)
- [ ] Track 4: React SDK (hooks and components)
- [ ] Track 5: Console integration (redemption route, settings panel)
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Notes

_Add any additional notes, links, or context here as the project evolves._