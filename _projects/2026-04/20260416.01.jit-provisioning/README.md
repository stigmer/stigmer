# Project: 20260416.01.jit-provisioning

## Overview
Add JIT (Just-In-Time) provisioning to IdentityProvider: auto_provision_accounts for identity creation, auto_grant_on_org for authorization, auto_grant_role for role selection, and tenant_org_claim for multi-tenant JWT claim mapping. Eliminates manual createFederatedAccount and IAM policy steps for platforms using federation.

**Created**: 2026-04-16
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable zero-friction federation where a platform JWT works end-to-end without any backend provisioning steps, while preserving full manual control as an opt-in for platforms that need it.

### Timeline
**Target Completion**: 1 month

### Technology Stack
Protobuf, Java/Spring (stigmer-cloud backend), TypeScript (SDK), Go (SDK), Python (SDK), MDX (docs)

### Project Type
Feature Development

### Affected Components
IdentityProvider proto (stigmer), FederatedAuthenticationToken (stigmer-cloud), SsoAutoProvisionerImpl (stigmer-cloud), RequestCallerIdentityMapper (stigmer-cloud), IdP validation handlers (stigmer-cloud), SDK type generation (stigmer), federation docs (stigmer)

## Project Context

### Dependencies
Changes span two repos: stigmer (protos, SDK, docs) and stigmer-cloud (Java service implementation). Proto changes in stigmer must be published before stigmer-cloud can consume them.

### Success Criteria
- Platform can set auto_provision_accounts + auto_grant_on_org on IdP and users are auto-provisioned with correct role on first JWT
- Multi-tenant platforms can set auto_provision_accounts only and manage tenant org access via IAM policies
- tenant_org_claim enables fully automated multi-tenant provisioning with JWT claim to org mapping
- Existing SSO and manual federation flows continue working unchanged
- All new fields have validation with clear error messages

### Known Risks & Mitigations
Backward compatibility with existing SSO auto-provisioning behavior,Security implications of auto-provisioning (rate limiting abuse via JWT generation),Proto field numbering must not conflict with future is_sso_provider or oidc_client_id changes,Cross-repo coordination between stigmer and stigmer-cloud for proto changes

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