# Project: 20260503.04.auth0-webhook-pipeline-cleanup

## Overview
Remove the obsolete Auth0 webhook-based identity provisioning pipeline from Stigmer Cloud. The system already has synchronous JIT/SSO auto-provisioning via FederatedAutoProvisioner, making the entire webhook pipeline dead code.

**Created**: 2026-05-03
**Status**: Active 🟢

## Project Information

### Primary Goal
Delete the auth0-webhooks-receiver Cloudflare Worker, the Temporal workflow/activities for identity account creation from Auth0, the SimulateSignupWebhook RPC, Auth0 Management API code, and all associated config/credentials. Clean delete with no deprecation.

### Timeline
**Target Completion**: 1 day

### Technology Stack
Java/Spring (stigmer-service), TypeScript (Cloudflare Worker), Protobuf, Kustomize/YAML

### Project Type
Refactoring

### Affected Components
stigmer-cloud: backend/services/auth0-webhooks-receiver, backend/services/stigmer-service (IAM identity account domain, config/auth0), _ops/planton configs, kustomize overlays. stigmer OSS: apis/ai/stigmer/iam/identityaccount/v1/command.proto (remove simulateSignupWebhook RPC)

## Project Context

### Dependencies
None - pure dead code removal

### Success Criteria
- All Auth0 webhook pipeline code deleted. Backend build passes. No references to auth0-webhooks-receiver
- CreateIdentityAccountFromAuth0Workflow
- SimulateSignupWebhook
- or Auth0 Management API remain in active code.

### Known Risks & Mitigations
Low - dev stage product with 2 users, both already provisioned. No external consumers of the deleted code.

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