# Project: 20260127.01.skill-source-metadata

## Overview
Enhance skill push to capture source metadata (GitHub repo + sub-directory or local filesystem), and extract skill name from SKILL.md YAML (required) instead of folder name

**Created**: 2026-01-27
**Status**: Active 🟢

## Project Information

### Primary Goal
Support both local directory push (with auto-detected git info) and remote GitHub URL push (URL + tag/commit + subdir), with source metadata stored in skill state

### Timeline
**Target Completion**: 2-3 days

### Technology Stack
Go/CLI, Protobuf, Java/Backend

### Project Type
Feature Development

### Affected Components
Proto APIs (spec.proto, io.proto), CLI (skill.go, artifact/skill.go), Backend service handlers

## Project Context

### Dependencies
None identified

### Success Criteria
- 1. Can push skill from local dir with auto-detected git info + name from YAML. 2. Can push skill from remote GitHub URL with subdir. 3. Source metadata stored in skill status/state.

### Known Risks & Mitigations
Needs careful proto design for backward compatibility. Git info detection may have edge cases.

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