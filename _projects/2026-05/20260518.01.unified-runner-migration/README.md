# Project: 20260518.01.unified-runner-migration

## Overview
Migrate Python agent-runner and TypeScript cursor-runner into a single unified TypeScript runner service (backend/services/runner/), eliminating Python from the agent execution path and creating a common codebase for both LangGraph deep agents and Cursor SDK harnesses.

**Created**: 2026-05-18
**Status**: Active 🟢

## Project Information

### Primary Goal
Single TypeScript runner service that handles ExecuteDeepAgent, ExecuteCursor, EnsureThread, DiscoverMcpServer, and ClassifyToolApprovals — with all shared infrastructure (MCP resolver, HITL, status builder) unified. Python agent-runner, cursor-runner, and graphton library deleted after validated cutover.

### Timeline
**Target Completion**: 20-29 days (8 phases, Phase 0 is a hard research gate)

### Technology Stack
TypeScript/Node.js, Temporal SDK, deepagents JS (npm), LangGraph JS, Connect-ES (gRPC), @bufbuild/protobuf, Vitest

### Project Type
Migration

### Affected Components
backend/services/agent-runner (Python, to be retired), backend/services/cursor-runner (TypeScript, to be retired), backend/libs/python/graphton (to be retired), backend/services/runner (NEW), backend/services/agent-runner/sandbox/Dockerfile.sandbox.full, .github/workflows/release.sandbox-cloud.yaml

## Project Context

### Dependencies
deepagents JS middleware parity (Phase 0 gate), LangGraph JS checkpointer support (Phase 0 gate), Java workflow queue routing coordination (stigmer-cloud)

### Success Criteria
- 1. Unified runner executes both ExecuteDeepAgent and ExecuteCursor in production. 2. All Python agent-runner tests ported to Vitest and passing. 3. Sandbox image builds with single runner instead of Python+Node. 4. Python agent-runner
- cursor-runner
- and graphton deleted from repo. 5. No regression in HITL
- streaming
- MCP
- billing
- or session memory.

### Known Risks & Mitigations
1. deepagents JS may lack critical middleware hooks (mitigated by Phase 0 gate). 2. LangGraph JS checkpointer immaturity (mitigated by Phase 0 validation). 3. Temporal queue routing changes require coordinated Java deployment. 4. Test coverage gaps during migration.

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