# Project: 20260123.01.standardize-cli-apply-output

## Overview
Standardize CLI apply command output to match Pulumi's tabular display format for resource deployment

**Created**: 2026-01-23
**Status**: Active 🟢

## Project Information

### Primary Goal
Create a professional tabular display for the apply command that shows agents, workflows, and skills being applied, similar to Pulumi's resource table

### Timeline
**Target Completion**: 1-2 days

### Technology Stack
Go, CLI rendering, table formatting libraries

### Project Type
Feature Development

### Affected Components
CLI apply command, display/output formatting, test fixtures

## Project Context

### Dependencies
Inspired by Pulumi's backend/display package (progress.go)

### Success Criteria
- Apply command outputs a clean table showing resource type
- name
- and status. E2e tests can easily extract resource IDs. Output is professional and consistent.

### Known Risks & Mitigations
Need to maintain backward compatibility with existing tests, choose appropriate Go table library

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