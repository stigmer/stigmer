# Project: 20260521.01.pre-deploy-integration-test-expansion

## Overview
Comprehensive pre-deployment test expansion: fix broken workflow execution path (Phase 8 cutover from TS rewrite), wire 65 orphaned Java tests, add ~95 new integration tests across agent execution journeys, resource CRUD, streaming, and structural Playwright E2E.

**Created**: 2026-05-21
**Status**: Active 🟢

## Project Information

### Primary Goal
Maximize deployment confidence by restoring ~135 broken/unwired tests and adding ~95 new tests across Go integration (conversation journeys, lifecycle edge cases, CRUD, streaming), structural Playwright E2E (settings, library, error states, accessibility), SDK component tests, and Java service parity. Fix the workflow execution architecture gap (Java/Go orchestrator child workflow rewrite) and wire orphaned BUILD.bazel targets in stigmer-cloud.

### Timeline
**Target Completion**: 2-3 weeks (17-22 sessions)

### Technology Stack
Go (integration tests, stigmer-server orchestrator), Java 21/Spring Boot/Bazel (stigmer-service orchestrator, BUILD.bazel wiring), TypeScript/Node.js (unified runner hydration activity, Vitest), Playwright (E2E browser tests), Temporal (workflow orchestration changes)

### Project Type
Feature Development

### Affected Components
test/integration/ (Go harness + new tests), test/e2e/ (Playwright specs), backend/services/runner/ (TS hydration activity), backend/services/stigmer-server/ (Go orchestrator rewrite), stigmer-cloud/backend/services/stigmer-service/ (Java orchestrator rewrite + BUILD.bazel), sdk/react/ (component tests)

## Project Context

### Dependencies
Unified runner migration (Session 14 complete), workflow-runner-typescript-rewrite (Phase 8 cutover NOT done -- this project completes it), stigmer-cloud sibling repo for Java service JAR

### Success Criteria
- 1) make test-integration compiles and runs all ~70 workflow tests (currently broken). 2) Workflow execution works end-to-end through unified TS runner via child workflow dispatch. 3) 65 orphaned Java tests wired in BUILD.bazel and passing. 4) ~40 new Go integration tests covering conversation journeys
- CRUD
- streaming
- tool calls. 5) ~30 new structural Playwright E2E tests for settings/library/error states. 6) bazelw test step added to stigmer-cloud deploy pipeline.

### Known Risks & Mitigations
1) Workflow execution may already be broken in production (old Go workflow-runner deleted from repo -- verify deployment status). 2) TS hydration activity is the gating item (~250-400 LOC new code). 3) Some orphaned Java tests may have stale imports from deleted Runner domain. 4) Pause/resume parity for workflows deferred (needs TS checkpoint support). 5) Progressive status reporting may regress (old Go interceptor pattern not replicated in TS engine).

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