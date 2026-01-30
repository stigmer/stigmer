# Project: 20260127.02.agent-skills-spec-alignment

## Overview
Align Stigmer's Agent Skills implementation with the official Agent Skills specification (agentskills.io), including proper description field storage and system prompt injection format

**Created**: 2026-01-27
**Status**: Active 🟢

## Project Information

### Primary Goal
Ensure our skills implementation follows the Agent Skills spec by: (a) storing skill description in SkillSpec proto, (b) using proper XML format for system prompt injection with name/description/location

### Timeline
**Target Completion**: 1 week

### Technology Stack
Protobuf, Go (CLI + backend)

### Project Type
Refactoring

### Affected Components
Proto definitions (apis/ai/stigmer/agentic/skill/v1/spec.proto), CLI skill parsing (client-apps/cli/internal/cli/artifact/), Backend skill controller, System prompt generation

## Project Context

### Dependencies
None identified

### Success Criteria
- Skills are stored with description field extracted from SKILL.md frontmatter; System prompt injection follows Agent Skills XML format with name/description/location

### Known Risks & Mitigations
None significant

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