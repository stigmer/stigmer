# Project: 20260405.01.iam-role-permission-separation

## Overview
Split the monolithic ApiResourceIamPermission enum into separate IamRole and IamPermission enums, add grantable_roles to AuthorizationConfig per ApiResourceKind, and update all dependents across protos, backend, and SDKs.

**Created**: 2026-04-05
**Status**: Active 🟢

## Project Information

### Primary Goal
Separate what-you-assign (roles) from what-the-system-checks (permissions) from internal-FGA-wiring (structural relations). Add admin as a first-class role. Make each ApiResourceKind declare its grantable roles so the web app can render role selectors dynamically and SDKs can validate at creation time.

### Timeline
**Target Completion**: 1 week

### Technology Stack
Protobuf, Java (backend FGA tuple creation), TypeScript/Go/Python/Java (SDK codegen)

### Project Type
Refactoring

### Affected Components
apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/ (split enum), apis/ai/stigmer/commons/apiresource/apiresourcekind/ (add grantable_roles to AuthorizationConfig and ApiResourceKind), all command/query .proto files using permission annotations, stigmer-cloud/backend/ Java FGA tuple creation code, SDK codegen outputs

## Project Context

### Dependencies
None - this is a standalone refactoring that all other work benefits from

### Success Criteria
- IamRole enum with owner/admin/member/viewer
- IamPermission enum with all can_* permissions
- structural relations removed from both
- every ApiResourceKind declares grantable_roles
- RpcAuthorizationConfig uses new IamPermission type
- backend compiles and tests pass
- documentation explains roles vs permissions

### Known Risks & Mitigations
Proto field number conflicts during split, backward compatibility for existing SDK consumers, Java backend compilation breakage from enum rename, migration strategy for FGA tuple creation code that references old enum values

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