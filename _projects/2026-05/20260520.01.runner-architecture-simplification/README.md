# Project: 20260520.01.runner-architecture-simplification

## Overview
Eliminate the overengineered Runner API resource (CRUD, bidi stream, 6-phase lifecycle, launch tokens) and replace it with a simple @stigmer/runner NPM package using per-session Temporal task queue routing. No backward compatibility — delete the Runner API entirely.

**Created**: 2026-05-20
**Status**: Active 🟢

## Project Information

### Primary Goal
Single @stigmer/runner NPM package with a createStigmerRunner() factory function that uses per-session Temporal task queues. Runner API protos deleted. Control plane routes executions via session-derived task queues instead of runner IDs. Desktop app embeds the runner automatically. Cloud sandbox boots with session ID. Customers can npm install and integrate in minutes.

### Timeline
**Target Completion**: 2-3 weeks (must complete before unified-runner-migration Phase 6 Deployment)

### Technology Stack
TypeScript/Node.js, Temporal TypeScript SDK, Protobuf/gRPC (deletion), Java Spring Boot (stigmer-service control plane changes), Vitest

### Project Type
Refactoring

### Affected Components
apis/ai/stigmer/agentic/runner (DELETE), backend/services/runner (refactor to NPM package), stigmer-cloud/stigmer-service Runner controllers and DB (DELETE), session routing in stigmer-service, desktop app runner lifecycle, Electron IPC for filesystem browsing

## Project Context

### Dependencies
unified-runner-migration project (Phase 5 complete, Phase 6 blocked on this). workflow-runner-typescript-rewrite (parallel until deployment). Research report: research.control-plane-runner-architecture-review/04.report.gemini.md

### Success Criteria
- 1) Runner API protos (all 7 files) deleted. 2) RunnerQueryController + RunnerCommandController gRPC services deleted from stigmer-service. 3) Runner database tables removed. 4) @stigmer/runner NPM package with createStigmerRunner({temporalAddress
- stigmerEndpoint
- sessionTaskQueue}) API. 5) Per-session Temporal task queue routing working end-to-end. 6) Desktop app embeds runner without explicit user management. 7) Cloud sandbox boots with session ID
- no Runner resource. 8) No backward compatibility — clean break.

### Known Risks & Mitigations
1) Java control plane session routing refactor scope may be larger than expected. 2) Filesystem browsing replacement (Electron IPC for desktop, HTTP sidecar for cloud) needs design. 3) Existing sessions referencing runner_id need migration path (or just break — no backward compat). 4) Customer-facing API surface change requires communication.

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