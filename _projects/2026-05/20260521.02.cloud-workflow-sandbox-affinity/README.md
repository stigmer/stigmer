# Project: 20260521.02.cloud-workflow-sandbox-affinity

## Overview
Implement cloud-side workflow sandbox affinity — provision dedicated Daytona sandboxes for workflow executions so all child agent calls share a single sandbox instead of provisioning N separate ones.

**Created**: 2026-05-21
**Status**: Active 🟢

## Project Information

### Primary Goal
Complete the cloud-side implementation: EnsureWorkflowSandboxStep, SandboxTokenService workflow token minting, DaytonaSandboxProvisioner wfexec support, activity_task_queue wiring in agent dispatch, and security stripping of the override field from external API callers.

### Timeline
**Target Completion**: 2-3 days

### Technology Stack
Java 21/Spring Boot/Bazel (stigmer-cloud), Go (stigmer-server), TypeScript (runner — minor), Temporal

### Project Type
Feature Development

### Affected Components
stigmer-cloud/backend/services/stigmer-service/ (sandbox, dispatch, handlers), backend/services/stigmer-server/ (agent dispatch override wiring)

## Project Context

### Dependencies
OSS-side foundation complete (proto fields, Go dispatch, TS propagation). Cloud-side requires: Daytona SDK API for sandbox provisioning, SandboxTokenService JWT minting, stigmer-cloud BUILD.bazel test wiring.

### Success Criteria
- 1) Workflow executions with execution_target=CLOUD provision a single wfexec:{id} sandbox
- 2) Child agent executions reuse the parent workflow sandbox (no separate provision)
- 3) activity_task_queue stripped from external API callers
- 4) Existing session sandbox path unaffected
- 5) Integration tests validate the full dispatch-provision-reuse flow

### Known Risks & Mitigations
1) Daytona SDK may need new API surface for workflow-keyed sandboxes, 2) SandboxTokenService JWT scope change may affect existing token validation, 3) Cross-repo dependency — OSS agent create handler needs 5th arg wired, 4) Kustomize/deployment config changes needed for new env vars

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