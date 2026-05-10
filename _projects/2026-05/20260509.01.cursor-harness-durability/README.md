# Project: 20260509.01.cursor-harness-durability

## Overview
Build a durable conversation layer for the Cursor harness: replay/continuation for local agents, cloud agent path for git-backed workspaces, and Stigmer-owned session memory that survives agent eviction.

**Created**: 2026-05-09
**Status**: Active 🟢

## Project Information

### Primary Goal
Make Cursor-harness multi-turn conversations durable across hours/days, regardless of whether the underlying Cursor local agent is still resumable. Add a cloud-agent code path for git-backed sessions with native Cursor durability.

### Timeline
**Target Completion**: 2 weeks

### Technology Stack
TypeScript (cursor-runner), Java (stigmer-service/workflows), Protobuf (session/execution protos), MongoDB

### Project Type
Feature Development

### Affected Components
cursor-runner (TypeScript), stigmer-service workflow/dispatch (Java), session proto (workspace/spec), agent-sandbox Docker image

## Project Context

### Dependencies
Cursor SDK @cursor/sdk (confirmed local context bug in 1.0.x), Daytona sandbox persistent disk, Temporal polyglot workflow

### Success Criteria
- 1) Local Cursor sessions survive Agent.resume failure via replay/continuation. 2) Git-backed sessions use cloud agents with native durability. 3) Session memory persisted after each turn. 4) No raw transcript bloat in replay prompts. 5) Explicit platform.stateRoot/workspaceRef on local create/resume.

### Known Risks & Mitigations
1) Cursor local context bug may be fixed upstream, changing assumptions. 2) Cloud agents are repo-centric — may not cover all GitRepoSource variants. 3) Self-hosted cloud agents are Team/Enterprise only. 4) Replay quality may not match native Cursor context management.

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