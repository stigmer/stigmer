# Project: 20260405.02.identity-provider-flow

## Overview
Fix the MongoDB email uniqueness bug, remove JIT provisioning in favor of explicit platform-driven account creation, design self-managed SSO, build SDK React components and web app pages for IdP management, and write comprehensive documentation for the complete federation flow.

**Created**: 2026-04-05
**Status**: Active 🟢

## Project Information

### Primary Goal
Make the identity provider flow production-ready: fix email uniqueness bug, implement explicit federated account creation with proper authorization, enable self-managed orgs to use SSO, build SDK-first UI for IdP management and role granting, and document all flows for platform builders.

### Timeline
**Target Completion**: 2 weeks

### Technology Stack
Protobuf, Java (backend services, MongoDB migrations, FGA), TypeScript/React (SDK react, web app), MongoDB

### Project Type
Feature Development

### Affected Components
stigmer-cloud/backend/ (MongoDB migration for email index, FederatedIdentityProvisionerImpl removal, new authorized identity account creation RPC, FGA permissions), apis/ (org spec for self-managed SSO, identity account command proto for new RPC, new FGA permissions), sdk/react/ (new identity-provider and iam-policy feature folders), client-apps/web/ (IdP management pages in settings), docs/ (federation flow documentation)

## Project Context

### Dependencies
None - independent of the IAM role/permission separation project. Can proceed in parallel.

### Success Criteria
- Federated account creation works via explicit platform API call with proper authorization
- email uniqueness index removed without data loss
- JIT provisioning removed
- self-managed orgs can configure IdP for SSO
- SDK React has identity-provider hooks and components
- web app has IdP management pages
- documentation covers platform-managed flow with examples

### Known Risks & Mitigations
MongoDB migration for email index removal needs backward-compatible rollout, removing JIT changes the authentication flow fundamentally, self-managed SSO changes org spec proto (impacts all SDKs), existing federated accounts in production may need migration, FGA model needs new permissions for identity account creation in org context

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
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
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

## Sub-Projects

| Sub-Project | Path | Status | Description |
|-------------|------|--------|-------------|
| sso-login-flow | [20260407.01.sp.sso-login-flow](../20260407.01.sp.sso-login-flow/) | Active | Implement org-aware SSO login flow in the web app, add updateFederatedAccount and deprovisionFederatedAccount lifecycle RPCs, add SSO auto-provisioning for self-managed orgs, and surface a copyable SSO login URL in the IdP management screen. |
