# Project: 20260213.01.agent-artifact-lifecycle

## Overview
Implement production-grade artifact lifecycle for sandboxed agent execution: file inputs, file outputs, and persistent storage that survives sandbox failures.

**Created**: 2026-02-13
**Status**: Active 🟢

## Project Information

### Primary Goal
Enable users to upload files to agents, download agent-created artifacts, and persist work across sandbox restarts using Daytona Volumes and R2 artifact store.

### Timeline
**Target Completion**: 1 week (aggressive)

### Technology Stack
Go, Python, gRPC, Temporal, Daytona SDK, Cloudflare R2

### Project Type
Feature Development

### Affected Components
agent-runner, stigmer-server, CLI, proto APIs, Daytona integration

## Project Context

### Dependencies
Daytona SDK volume support, existing R2 artifact storage

### Success Criteria
- 1) Users can upload files as input to agent executions
- 2) Users can download artifacts created by agents
- 3) skill-creator-agent can create downloadable skill directories
- 4) User work survives sandbox restarts/failures
- 5) CLI commands for artifact upload/download

### Known Risks & Mitigations
Scope creep - implementing 3 milestones in 1 week is aggressive

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